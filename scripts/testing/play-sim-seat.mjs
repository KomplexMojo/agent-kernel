/**
 * Play-sim seat driver (#654): a model plays the player's seat for a whole level through
 * `ak play-session` (start, legal, act, end), the command behind the MCP tools ak_play_start,
 * ak_play_legal, ak_play_act and ak_play_end. Nothing here reaches into the runtime: the driver
 * sees only what an MCP client sees (fog on, the screen, the HUD line, the legal list), and the
 * session file is the only state, so a client without this script could play the same game.
 *
 * Each turn the picker chooses one id from `legal`. An id outside the list is refused and retried
 * (cap); core still decides outcomes and a refused command is counted. The model drives the
 * player seat only; Actor NPC policy is untouched. Analysis, never a merge gate. Wiring to the
 * model host (OLLAMA_HOST / OLLAMA_MODEL, as under `remote-ollama-mac run-local`) is in play-sim.mjs.
 *
 *   node scripts/testing/play-sim.mjs --driver seat --model <id> --scenarios first-look --seeds 0
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conditionNote } from "../../packages/runtime/src/render/battle-log-lines.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

export const DEFAULT_MAX_TURNS = 60;
export const DEFAULT_RETRIES = 2;
export const HISTORY_TURNS = 8;

const HUD_KEYS = { HP: "health", MP: "mana", ST: "stamina", DU: "durability" };

/** `D1 hero-1 · HP 30/30 (+1) MP 60/60 ...` to { health: 30, mana: 60, ... }. */
export function vitalsFromHud(hud) {
  const out = {};
  for (const match of String(hud ?? "").matchAll(/\b(HP|MP|ST|DU)\s+(\d+)\/\d+/g)) out[HUD_KEYS[match[1]]] = Number(match[2]);
  return out;
}

/** The session over `ak play-session`: one subprocess per call, as an MCP tool call would be. */
export function createCliTransport({ sessionsDir, name = "seat" } = {}) {
  const dir = sessionsDir ?? mkdtempSync(join(tmpdir(), "ak-seat-"));
  const call = (action, extra = []) => {
    const run = spawnSync(process.execPath, [AK, "play-session", action, "--session", name, ...extra], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, AK_PLAY_SESSIONS_DIR: dir },
    });
    if (run.status !== 0) return { ok: false, error: (run.stderr || run.stdout || `ak exited ${run.status}`).trim().slice(0, 600) };
    return JSON.parse(run.stdout);
  };
  return {
    start: ({ dir: levelDir }) => call("start", ["--dir", levelDir]),
    legal: () => call("legal"),
    act: (command) => call("act", ["--commands", JSON.stringify([command])]),
    end: () => call("end"),
    cleanup: () => { if (!sessionsDir) rmSync(dir, { recursive: true, force: true }); },
  };
}

/** #692: ` (looks bloodied, 2 ticks ago)` for an actor our hits have read, worded as every UI words it. */
const conditionText = (condition) => (conditionNote(condition) ? ` (${conditionNote(condition)})` : "");

/** A picker backed by a model: it must answer `{ "action": "<id>" }` with an id from the list. */
export function llmSeatPicker({ adapter, model }) {
  const picker = async ({ result, actions, problem, history = [] }) => {
    const prompt = [
      "You play a character in a small dungeon game. Choose ONE action from the list. Answer JSON only: {\"action\": \"<id>\"}.",
      // Only what the actor can observe: no exit position is given. E appears on the screen once it has been seen.
      "Goal: find a way out of this dungeon and leave it. You do not know where the exit is. Explore: head for tiles marked ? or doors you have not been through, and do not walk back and forth over ground you have already seen. When an exit (E) is on your screen, go to it and stay on it.",
      "Legend: ? is unexplored, @ is you, other letters are other actors.",
      result.screen,
      ...(history.length ? ["Your last turns (oldest first; do not repeat a pattern that goes nowhere, and leave a tile that is hurting you):", ...history.map((turn) => `  ${turn.pick}${turn.refused ? " (refused)" : ""} -> ${turn.hud}`)] : []),
      ...(result.battleLog?.length ? ["Battle log (the Annotator's record of what happened to you and around you, newest last):", ...result.battleLog.map((line) => `  ${line}`)] : []),
      `Now: ${result.hud ?? ""}`,
      // #692: how hurt an actor looked when you last hit it, and how long ago; never its vitals.
      `In sight: ${(result.inSight || []).map((actor) => `${actor.label ?? actor.id} at ${JSON.stringify(actor.position)}${conditionText(actor.condition)}`).join("; ") || "nobody"}.`,
      ...(result.legalNote ? [`Note: ${result.legalNote}`] : []),
      "Actions:", ...actions.map((action) => `  ${action.id}: ${action.label}`),
      ...(problem ? [`Your last answer was refused: ${problem}`] : []),
    ].join("\n");
    // think:false keeps a reasoning model from spending its budget on a thinking channel and returning an empty answer.
    const answer = await adapter.generate({ model, prompt, format: "json", think: false, options: { temperature: 0.2 } });
    const text = String(answer?.response ?? answer?.text ?? answer).trim().replace(/^```(?:json)?|```$/g, "");
    picker.lastRaw = text || `(empty response${answer?.thinking ? "; the model only produced thinking" : ""})`;
    try { return JSON.parse(text).action; } catch { return null; }
  };
  return picker;
}

/** A picker that replays a recorded transcript's picks in order: the same game with no model call (#679). */
export function replayPicker(transcript) {
  const picks = transcript.map((turn) => turn.pick);
  let next = 0;
  return async () => picks[next++] ?? null;
}

/**
 * Play one level from `levelDir` to its end (exit, defeat, or `maxTurns`). Returns the outcome and
 * a transcript: one entry per turn with the pick, whether core refused it, and the HUD after.
 */
export async function runSeat({ transport, levelDir, picker, maxTurns = DEFAULT_MAX_TURNS, retries = DEFAULT_RETRIES }) {
  const log = { outcome: "timeout", turns: 0, ticks: 0, picks: 0, illegal: 0, rejectedAnswers: [], refusedByCore: 0, seat: null, finalVitals: {}, minVitals: {}, transcript: [] };
  let result = transport.start({ dir: levelDir });
  if (!result.ok) return { ...log, outcome: "start_failed", error: result.error };
  log.seat = result.active ?? null;
  const track = () => {
    const now = vitalsFromHud(result.hud);
    log.finalVitals = now;
    for (const [key, value] of Object.entries(now)) log.minVitals[key] = Math.min(log.minVitals[key] ?? value, value);
    log.ticks = result.status?.tick ?? log.ticks;
  };
  track();
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (result.status?.exited) { log.outcome = "exited"; break; }
    if (result.status?.defeated) { log.outcome = "defeated"; break; }
    const actions = result.legal ?? [];
    if (!actions.length) { log.outcome = "no_actions"; break; }
    let chosen = null;
    let problem;
    for (let attempt = 0; attempt <= retries && !chosen; attempt += 1) {
      const id = await picker({ result, actions, problem, history: log.transcript.slice(-HISTORY_TURNS) });
      chosen = actions.find((action) => action.id === id) ?? null;
      if (!chosen) {
        log.illegal += 1;
        problem = `"${id}" is not in the list. Answer with exactly one of: ${actions.map((action) => action.id).join(", ")}`;
        // What the model actually said, so an empty or malformed answer is visible in the record.
        if (log.rejectedAnswers.length < 6) log.rejectedAnswers.push(String(picker.lastRaw ?? id).slice(0, 200));
      }
    }
    if (!chosen) { log.outcome = "illegal"; break; }
    const next = transport.act(chosen.command);
    if (!next.ok) { log.outcome = "act_failed"; log.error = next.error; break; }
    const refused = (next.results || []).some((entry) => (entry.rejected || []).length);
    if (refused) log.refusedByCore += 1;
    log.picks += 1;
    // What the model was shown and could do this turn (the state before its pick), so a record can say
    // whether a counter was on offer. The prompt's history reads only pick/refused/hud.
    log.transcript.push({ turn: turn + 1, pick: chosen.id, refused, hud: next.hud, legal: actions.map((action) => action.id), screen: result.screen, ...(result.legalNote ? { legalNote: result.legalNote } : {}) });
    result = next;
    track();
  }
  if (log.outcome === "timeout") {
    if (result.status?.exited) log.outcome = "exited";
    else if (result.status?.defeated) log.outcome = "defeated";
  }
  log.turns = log.picks;
  return log;
}
