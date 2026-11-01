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
import { listLegalPlayCommands } from "../../packages/runtime/src/runner/play-legal-commands.js";

export const DEFAULT_BURST = 5;
export const DEFAULT_RETRIES = 2;

// The legal list lives in the runtime (#653), so a seat driven through `ak_play_legal` and this
// driver ask the same function. Re-exported: the T1 tests and play-sim import it from here.
export { listLegalPlayCommands };

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
