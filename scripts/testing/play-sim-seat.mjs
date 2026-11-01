/**
 * Play-sim G1 (#654): the LLM seat driver. A picker (a local model, or a fixture) plays a whole
 * level through a seat that offers look / act / end, choosing each turn only from the legal list
 * (`ak play-session legal`, #653). An id outside the list is refused and retried (cap), never
 * executed; core stays the authority and its refusals are counted. The run ends exited, defeated,
 * stuck (no actions), illegal (retry cap) or timeout (tick cap). Not a gate.
 *
 * The row it writes is the M2 run-record shape, so play-sim-report reads it. Rule hits need tick
 * frames the seat does not have, so `ruleHits` is [] and `seat.rulesChecked` is false.
 *
 * Use:  node scripts/testing/play-sim-seat.mjs --level first-steps --model phi4   (live Ollama, manual)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
export const DEFAULT_MAX_TICKS = 200;
export const DEFAULT_RETRIES = 2;

/** A picker backed by a model: it sees the screen and the legal list and answers `{"action": id}`. */
export function modelSeatPicker({ adapter, model }) {
  return async ({ view, actions, problem }) => {
    const prompt = [
      "You play a character in a small dungeon game. Choose ONE action from the list. Answer JSON only: {\"action\": \"<id>\"}.",
      "Goal: reach the exit (E).",
      view?.screen ?? "",
      view?.hud ?? "",
      `In sight: ${(view?.inSight || []).map((a) => `${a.label ?? a.id} at ${JSON.stringify(a.position)}`).join("; ") || "nobody"}.`,
      "Actions:", ...actions.map((a) => `  ${a.id}: ${a.label}`),
      ...(problem ? [`Your last answer was refused: ${problem}`] : []),
    ].join("\n");
    const answer = await adapter.generate({ model, prompt, format: "json", options: { temperature: 0.2 } });
    const text = String(answer?.response ?? answer?.text ?? answer).trim().replace(/^```(?:json)?|```$/g, "");
    try { return JSON.parse(text).action ?? null; } catch { return null; }
  };
}

/** Play one seat to its end. `seat.look()` → { status, legal, view }; `seat.act(command)` → { status, rejected }. */
export async function runSeat({ seat, picker, maxTicks = DEFAULT_MAX_TICKS, retries = DEFAULT_RETRIES }) {
  const log = { picks: [], illegal: 0, refusedByCore: 0, ticks: 0, outcome: "timeout" };
  for (let turn = 0; turn < maxTicks; turn += 1) {
    const { status, legal, view } = await seat.look();
    if (status?.exited) { log.outcome = "exited"; break; }
    if (status?.defeated) { log.outcome = "defeated"; break; }
    if (!legal.length) { log.outcome = "no_actions"; break; }
    let chosen = null;
    let problem;
    for (let attempt = 0; attempt <= retries && !chosen; attempt += 1) {
      const id = await picker({ view: view ?? {}, actions: legal, problem });
      chosen = legal.find((action) => action.id === id) ?? null;
      if (!chosen) { log.illegal += 1; problem = `"${id}" is not in the list`; }
    }
    if (!chosen) { log.outcome = "illegal"; break; }
    const result = await seat.act(chosen.command);
    log.picks.push(chosen.id);
    log.ticks += 1;
    if ((result.rejected || []).length) log.refusedByCore += 1;
    if (result.status?.exited) { log.outcome = "exited"; break; }
    if (result.status?.defeated) { log.outcome = "defeated"; break; }
  }
  await seat.end?.();
  return log;
}

/** The seat's cohort row: the M2 record fields, plus a `seat` section for what only a seat knows. */
export function seatRecord({ scenario, seed = 0, model, log }) {
  return {
    schema: "agent-kernel/PlaySimRecord", version: 1,
    scenario, seed, arm: "baseline", strategy: "llm-seat",
    outcome: log.outcome, ticks: log.ticks, ruleHits: [],
    seat: { model, picks: log.picks, illegal: log.illegal, refusedByCore: log.refusedByCore, rulesChecked: false },
  };
}

export function writeSeatRun(dir, record) {
  mkdirSync(dir, { recursive: true });
  const file = `${record.scenario}-s${record.seed}-${record.arm}.json`;
  writeFileSync(join(dir, file), `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/** A seat backed by the `ak play-session` CLI (what ak_play_* wraps), in its own sessions dir. */
export function cliSeat({ level, session = "seat", sessionsDir }) {
  const dir = sessionsDir ?? mkdtempSync(join(tmpdir(), "play-seat-"));
  const call = (action, extra = []) => {
    const result = spawnSync(process.execPath, [AK, "play-session", action, "--session", session, ...extra, "--json"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, AK_PLAY_SESSIONS_DIR: dir },
    });
    let body;
    try { body = JSON.parse(result.stdout); } catch { throw new Error(`play-session ${action}: ${(result.stderr || result.stdout).slice(0, 300)}`); }
    if (!body.ok) throw new Error(`play-session ${action}: ${body.error}`);
    return body;
  };
  call("start", ["--level", level]);
  return {
    async look() {
      const body = call("legal");
      return { status: body.status, legal: body.legal, view: { screen: body.screen, hud: body.hud, inSight: body.inSight } };
    },
    async act(command) {
      const body = call("act", ["--commands", JSON.stringify([command])]);
      const last = (body.results || []).at(-1) ?? {};
      return { status: body.status, rejected: last.rejected || [] };
    },
    async end() {
      try { call("end"); } finally { if (!sessionsDir) rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

function parseArgs(argv) {
  const options = { maxTicks: DEFAULT_MAX_TICKS, retries: DEFAULT_RETRIES, seed: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--level") options.level = argv[++i];
    else if (arg === "--model") options.model = argv[++i];
    else if (arg === "--ollama-url") options.ollamaUrl = argv[++i];
    else if (arg === "--max-ticks") options.maxTicks = Number(argv[++i]);
    else if (arg === "--retries") options.retries = Number(argv[++i]);
    else if (arg === "--out-dir") options.outDir = resolve(argv[++i]);
    else throw new Error(`unknown option ${arg}`);
  }
  if (!options.level) throw new Error("--level is required (a bundled level name)");
  if (!options.model) throw new Error("--model is required");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { createLlmAdapter } = await import("../../packages/adapters-cli/src/adapters/llm/index.js");
    const adapter = createLlmAdapter(options.ollamaUrl ? { baseUrl: options.ollamaUrl } : {});
    const log = await runSeat({ seat: cliSeat({ level: options.level }), picker: modelSeatPicker({ adapter, model: options.model }), maxTicks: options.maxTicks, retries: options.retries });
    const outDir = options.outDir ?? join(ROOT, "artifacts/play-sim", `seat-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}`);
    const file = writeSeatRun(outDir, seatRecord({ scenario: options.level, seed: options.seed, model: options.model, log }));
    console.log(`${options.level}: ${log.outcome} in ${log.ticks} ticks (${log.illegal} illegal, ${log.refusedByCore} refused) → ${join(outDir, file)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
