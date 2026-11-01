/**
 * Play-sim M4 (#615): the T1 driver. On contact a picker (a local model, or a fixture) chooses the
 * seat's next command, but only from `listLegalPlayCommands(view)`, a stable list of commands the
 * play session can execute. An id not in the list is refused and retried (cap), never executed;
 * core stays the authority on outcomes (a listed command can still be refused, and is counted).
 * The model drives the player seat only; Actor NPC policy is untouched. Not a gate.
 *
 * Use:  node scripts/testing/play-sim.mjs --driver t1-contact --model phi4   (live Ollama, manual)
 */
import { createHash } from "node:crypto";
import { PLAY_DIRECTION_STEPS } from "../../packages/runtime/src/runner/play-session.js";

export const DEFAULT_BURST = 5;
export const DEFAULT_RETRIES = 2;

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const vitalNow = (player, key) => (player?.vitals || []).find((vital) => vital.key === key)?.current ?? 0;

/**
 * Commands the seat could try now, as `{ id, label, command }`, ordered by id. Read from the view
 * only (so fog hides what it hides). It is a candidate list: wall, barrier, actor and stamina checks
 * keep obvious refusals out; core still decides.
 */
export function listLegalPlayCommands(view) {
  const player = view?.player;
  if (!player || view.status?.exited || view.status?.defeated) return [];
  const actions = [{ id: "wait", label: "wait a turn", command: { kind: "wait" } }];
  const rows = view.rows || [];
  const legend = view.legend || {};
  const solid = new Set([legend.wall, legend.barrier, ...(legend.wallGlyphs || [])].filter(Boolean));
  const occupied = new Set([...(view.actors || []), ...(view.hazards || [])].filter((actor) => actor.position).map((actor) => `${actor.position.x},${actor.position.y}`));
  const free = (x, y) => {
    const glyph = [...(rows[y] || "")][x];
    return glyph !== undefined && glyph !== legend.fog && !solid.has(glyph) && !occupied.has(`${x},${y}`);
  };
  const stamina = vitalNow(player, "stamina");
  const costs = player.moveStamina;
  for (const [direction, { dx, dy }] of Object.entries(PLAY_DIRECTION_STEPS)) {
    const to = { x: player.position.x + dx, y: player.position.y + dy };
    if (!free(to.x, to.y)) continue;
    const step = costs ? (dx !== 0 && dy !== 0 ? costs.diagonal : costs.step) : 0;
    if (step <= stamina) actions.push({ id: `move:${direction}`, label: `step ${direction}`, command: { kind: "move", params: { direction } } });
    const far = { x: to.x + dx, y: to.y + dy };
    if (free(far.x, far.y) && (costs ? costs.sprint : 0) <= stamina) {
      actions.push({ id: `sprint:${direction}`, label: `sprint ${direction}`, command: { kind: "move", params: { direction, sprint: true } } });
    }
  }
  const mana = vitalNow(player, "mana");
  const targets = [...(view.actors || []), ...(view.hazards || [])].filter((actor) => actor.position);
  for (const [key, { range, mana: price }] of Object.entries(player.castableAffinities || {})) {
    if (price !== undefined && price > mana) continue;
    for (const target of targets) {
      if (chebyshev(player.position, target.position) > range) continue;
      actions.push({ id: `cast:${key}@${target.id}`, label: `cast ${key.replace(":", " ")} at ${target.label ?? target.id}`,
        command: { kind: "cast_affinity", params: { targetId: target.id, affinityKey: key } } });
    }
  }
  for (const item of view.loot || []) {
    actions.push({ id: `take:${item.targetId}:${item.holdingId}`, label: `take from ${item.targetId}`,
      command: { kind: "take", params: { targetId: item.targetId, holdingId: item.holdingId } } });
  }
  return actions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A picker backed by a model: it must answer `{ "action": "<id>" }` with an id from the list. */
export function llmPicker({ adapter, model }) {
  return async ({ actions, view, problem }) => {
    const prompt = [
      "You play a character in a small dungeon game. Choose ONE action from the list. Answer JSON only: {\"action\": \"<id>\"}.",
      `Goal: reach the exit (E). You are at ${JSON.stringify(view.player.position)}. Vitals: ${(view.player.vitals || []).map((v) => `${v.key} ${v.current}/${v.max}`).join(", ")}.`,
      `In sight: ${(view.actors || []).map((a) => `${a.label ?? a.id} at ${JSON.stringify(a.position)}`).join("; ") || "nobody"}.`,
      "Actions:", ...actions.map((a) => `  ${a.id}: ${a.label}`),
      ...(problem ? [`Your last answer was refused: ${problem}`] : []),
    ].join("\n");
    const answer = await adapter.generate({ model, prompt, format: "json", options: { temperature: 0.2 } });
    const text = String(answer?.response ?? answer?.text ?? answer).trim().replace(/^```(?:json)?|```$/g, "");
    try { return JSON.parse(text).action; } catch { return null; }
  };
}

/**
 * One T1 burst: up to `burst` turns, each picked from the legal list. Illegal or missing picks are
 * refused and retried up to `retries`; after that the burst ends. Returns the log.
 */
export async function runBurst({ session, picker, burst = DEFAULT_BURST, retries = DEFAULT_RETRIES }) {
  const log = { picks: [], illegal: 0, refusedByCore: 0, ended: "burst" };
  for (let turn = 0; turn < burst; turn += 1) {
    const view = session.view();
    const actions = listLegalPlayCommands(view);
    if (!actions.length) { log.ended = "no_actions"; break; }
    let chosen = null;
    let problem;
    for (let attempt = 0; attempt <= retries && !chosen; attempt += 1) {
      const id = await picker({ view, actions, problem });
      chosen = actions.find((action) => action.id === id) ?? null;
      if (!chosen) { log.illegal += 1; problem = `"${id}" is not in the list`; }
    }
    if (!chosen) { log.ended = "illegal"; break; }
    const result = await session.act(chosen.command);
    log.picks.push(chosen.id);
    if ((result.rejected || []).length) log.refusedByCore += 1;
    if (result.status?.exited || result.status?.defeated) { log.ended = result.status.exited ? "exited" : "defeated"; break; }
  }
  log.fingerprint = createHash("sha256").update(log.picks.join("|")).digest("hex").slice(0, 12);
  return log;
}
