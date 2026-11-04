#!/usr/bin/env node
/**
 * Play-sim M1 (#612): play the playtest scenarios headless, twice per scenario and seed, once at the
 * level's full budget (baseline) and once with the budget cut to 90% (treatment), and write one
 * metrics + rule-hit JSON per run. It answers whether a 10% smaller allowance changes outcomes,
 * with no LLM and no tile picking. Output is analysis for a human or a later report (M2); it is
 * never a merge gate.
 *
 *   node scripts/testing/play-sim.mjs --scenarios first-look,duel --seeds 0,1 [--out-dir dir]
 *        [--baseline-only | --treatment-only] [--strategy dash|fight] [--max-ticks 200]
 *
 * Default out dir: artifacts/play-sim/<run-id> (gitignored; cards are not committed).
 *
 * T0 driver: the seated user_controlled actor is given one `order` (the strategy below) and the
 * game then `advance`s with no further input, exactly as ak_play_order / ak_play_advance do.
 *   dash   reach the exit and nothing else (default)
 *   fight  reach the exit, but cast at the nearest hostile once one is within 2 tiles
 *
 * `--driver t1-contact --model <id>` (M4, #615) hands the seat to a model for a short burst whenever
 * a hostile comes into sight, choosing only from `listLegalPlayCommands` (play-sim-t1.mjs); T0
 * resumes after each burst. Default driver `t0`.
 *
 * `--driver seat --model <id>` (#654) hands the seat to a model for the whole level, through
 * `ak play-session` (the command behind ak_play_start / ak_play_legal / ak_play_act), seeing only
 * the fogged screen and the legal list (play-sim-seat.mjs). No T0 order is given.
 *
 * `--build-source llm --model <id>` (M3, #614) lets a local Ollama model propose the player's
 * character near each arm's delver allowance; the character sheet (the Allocator's prices) must
 * accept it, with up to 3 attempts, else the arm records `build_refused`. Live use is manual
 * (`--provider anthropic` swaps Ollama for the Anthropic API: ANTHROPIC_API_KEY from the environment, `--model` required, key never logged;
 * the Ollama host comes from `--ollama-url`, else OLLAMA_HOST, else localhost:11434; the model from `--model`, else OLLAMA_MODEL); the model id and prompt hash go in each
 * record. It is analysis, never a gate. The default stays the scenario's own character.
 *
 * The treatment scales `--budget-tokens` by 0.9. The delver pool is a fixed share of that total
 * (ak create does not take a per-pool cap), so the whole level shrinks with it; each run records
 * the delver pool's cap and spend from the budget receipt so the arms can be compared on it.
 * The harness holds no policy: levels come from `ak create` (the Allocator prices them) and play
 * goes through the runtime play session.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlaySession } from "../../packages/runtime/src/runner/play-session.js";
import { loadPlaytestScenarios, playerDelverSpec, scenarioArgs } from "../game/playtest.mjs";
import { analyzeRun, checkRules } from "./simulation-lib.mjs";
import { proposeCharacterSpec } from "./play-sim-llm-build.mjs";
import { llmPicker, runBurst } from "./play-sim-t1.mjs";
import { resolveModelEnv } from "./play-sim-model-env.mjs";
import { createCliTransport, llmSeatPicker, runSeat } from "./play-sim-seat.mjs";
import { createAnthropicAdapter, resolveProvider } from "./play-sim-anthropic.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

export const TREATMENT_SHARE = 0.9;
export const DEFAULT_SEEDS = [0, 1];
export const DEFAULT_MAX_TICKS = 200;
const CHUNK = 5;

/** The T0 order for the seated actor: a strategy `ak_play_order` accepts. */
export function strategyFor(name) {
  // #725: a strategy object (a strategy recipe's, say) is ordered as given.
  if (name && typeof name === "object") return name;
  const goals = [{ kind: "reach", place: "exit" }];
  if (name === "dash") return { goals };
  if (name === "fight") {
    return { goals, tactics: [{ when: { hostileWithin: 2 }, do: { kind: "cast_affinity", params: { targetId: "nearest_hostile" } } }] };
  }
  throw new Error(`unknown strategy "${name}" (dash or fight)`);
}

/** The two arms for a scenario: the full budget and `floor(0.9 ×)` of it. */
export function armBudgets(scenario, { baseline = true, treatment = true } = {}) {
  const arms = [];
  if (baseline) arms.push({ arm: "baseline", budgetTokens: scenario.budgetTokens });
  if (treatment) arms.push({ arm: "treatment", budgetTokens: Math.floor(TREATMENT_SHARE * scenario.budgetTokens) });
  return arms;
}

function ak(args) {
  const result = spawnSync(process.execPath, [AK, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Build one arm through `ak create`; returns { ok, dir, error?, args } and cleans nothing up. */
export function buildArm(scenario, seed, { arm, budgetTokens }, workDir, createdAt, character) {
  const dir = join(workDir, `${scenario.id}-s${seed}-${arm}`);
  const args = scenarioArgs({ ...scenario, budgetTokens }, seed, undefined, character);
  const result = ak(["create", "--run-id", `play-sim-${scenario.id}-s${seed}-${arm}`, "--created-at", createdAt, ...args, "--out-dir", dir]);
  if (result.status !== 0) return { ok: false, dir, args, error: `${result.stderr}${result.stdout}`.trim().slice(0, 600) };
  return { ok: true, dir, args };
}

const vitalsOf = (view) => Object.fromEntries((view?.player?.vitals ?? []).map((vital) => [vital.key, vital.current]));

/** Play a built level with the T0 driver; returns the outcome and what was seen on the way. */
export async function playArm(dir, { strategy = "dash", maxTicks = DEFAULT_MAX_TICKS, picker = null, burst, retries, seatPicker = null, transport = null } = {}) {
  if (seatPicker) {
    const own = transport ?? createCliTransport();
    try {
      const log = await runSeat({ transport: own, levelDir: dir, picker: seatPicker, maxTurns: maxTicks, retries });
      return { outcome: log.outcome, ticks: log.ticks, seat: log.seat, finalVitals: log.finalVitals, minVitals: log.minVitals,
        seatLog: { turns: log.turns, illegal: log.illegal, rejectedAnswers: log.rejectedAnswers, refusedByCore: log.refusedByCore, ...(log.error ? { error: log.error } : {}), transcript: log.transcript } };
    } finally {
      if (!transport) own.cleanup();
    }
  }
  const simConfig = readJson(join(dir, "sim-config.json"));
  const initialState = readJson(join(dir, "initial-state.json"));
  const session = await createPlaySession({ simConfig, initialState, fog: false });
  const seat = session.playerActorId;
  const ordered = await session.order(seat, strategyFor(strategy));
  if (!ordered.ok) return { outcome: "order_refused", reason: ordered.reason, ticks: ordered.tick ?? 0, minVitals: {} };
  let lastVitals = vitalsOf(session.view());
  const minVitals = { ...lastVitals };
  let outcome = "timeout";
  let status = ordered.status;
  const t1 = { bursts: 0, picks: 0, illegal: 0, refusedByCore: 0 };
  while (status.tick < maxTicks) {
    const step = await session.advance({ ticks: Math.min(CHUNK, maxTicks - status.tick), ...(picker ? { until: "contact" } : {}) });
    status = step.status;
    if (picker && step.stoppedBy === "contact") {
      const log = await runBurst({ session, picker, burst, retries });
      t1.bursts += 1; t1.picks += log.picks.length; t1.illegal += log.illegal; t1.refusedByCore += log.refusedByCore;
      status = session.status();
      // T0 resumes: the standing order carries on until the next contact.
      if (!status.exited && !status.defeated) status = (await session.advance({ ticks: CHUNK })).status;
    }
    const now = vitalsOf(session.view());
    if (Object.keys(now).length) {
      lastVitals = now;
      for (const [key, value] of Object.entries(now)) minVitals[key] = Math.min(minVitals[key] ?? value, value);
    }
    if (status.exited) { outcome = "exited"; break; }
    if (status.defeated) { outcome = "defeated"; break; }
  }
  return { outcome, ticks: status.tick, seat, finalVitals: lastVitals, minVitals, ...(picker ? { t1 } : {}) };
}

/** Rule tags: the static rules on the built level, plus the ones only play can show. */
export function ruleHits(scenario, args, dir, played) {
  const initialState = readJson(join(dir, "initial-state.json"));
  const castManaBase = readJson(join(dir, "sim-config.json")).actionCosts?.castManaBase;
  const analysis = { ...analyzeRun({ initialState, frames: [], castManaBase }), ticks: played.ticks };
  const hits = checkRules({ id: scenario.id, args }, analysis).map((hit) => ({ rule: hit.rule, ...(hit.actor ? { actor: hit.actor } : {}), ...(hit.detail ? { detail: hit.detail } : {}) }));
  if (played.outcome === "defeated" && played.ticks <= 1) hits.push({ rule: "tick_one_defeat", actor: played.seat });
  if (played.outcome === "timeout") hits.push({ rule: "no_exit", detail: `no exit within ${played.ticks} ticks` });
  return hits;
}

function delverPool(dir) {
  try {
    const pool = readJson(join(dir, "budget-receipt.json")).poolStatuses?.find((entry) => entry.id === "delver");
    return pool ? { capTokens: pool.capTokens, spentTokens: pool.spentTokens } : null;
  } catch { return null; }
}

/** One record: scenario, seed, arm, build fingerprint, outcome, metrics, rule hits. */
export async function runOne(scenario, seed, armSpec, { workDir, createdAt, strategy, maxTicks, llm = null, picker = null, seatPicker = null, transport = null, character: given = undefined }) {
  const base = { scenario: scenario.id, seed, arm: armSpec.arm, budgetTokens: armSpec.budgetTokens, strategy };
  // A given character (the power ladder's scaled delver) takes the scenario delver's place, priced as usual.
  let character = given;
  if (llm) {
    // M3: size the arm's delver allowance from a plain build, then let the model fill it.
    const probe = buildArm(scenario, seed, armSpec, workDir, createdAt);
    const allowance = probe.ok ? delverPool(probe.dir)?.capTokens : undefined;
    if (!Number.isFinite(allowance)) return { ...base, outcome: "create_failed", ticks: 0, delverPool: null, build: null, ruleHits: [{ rule: "create_failed", detail: probe.error ?? "no delver pool in the receipt" }] };
    const proposed = await proposeCharacterSpec({ llm: llm.adapter, model: llm.model, allowance, baseSpec: playerDelverSpec(scenario, seed) });
    base.llm = { model: proposed.model, promptHash: proposed.promptHash, attempts: proposed.attempts };
    if (!proposed.ok) return { ...base, outcome: "build_refused", ticks: 0, delverPool: { capTokens: allowance, spentTokens: null }, build: null, ruleHits: [{ rule: "build_refused", detail: proposed.problems.join("; ").slice(0, 400) }] };
    character = proposed.spec;
    base.llm.spec = character;
  }
  const built = buildArm(scenario, seed, armSpec, workDir, createdAt, character);
  if (!built.ok) {
    return { ...base, outcome: "create_failed", ticks: 0, delverPool: null, build: null, ruleHits: [{ rule: "create_failed", detail: built.error }] };
  }
  const played = await playArm(built.dir, { strategy, maxTicks, picker, seatPicker, transport });
  const initialState = readJson(join(built.dir, "initial-state.json"));
  const actors = (initialState.actors ?? []).filter((actor) => !/^barrier_/.test(actor.id)).map((actor) => ({ id: actor.id, motivations: actor.motivations ?? [], affinities: (actor.affinities ?? []).map((pair) => `${pair.kind}:${pair.expression}:${pair.stacks}:${pair.intensity ?? 1}`), vitals: Object.fromEntries(Object.entries(actor.vitals ?? {}).map(([key, vital]) => [key, vital.max])) }));
  const fingerprint = actors.map((actor) => `${actor.id}[${actor.affinities.join(",")}|${Object.entries(actor.vitals).map(([key, max]) => `${key}${max}`).join(",")}]`).join(" ");
  return {
    ...base,
    outcome: played.outcome,
    ticks: played.ticks,
    seat: played.seat ?? null,
    finalVitals: played.finalVitals ?? null,
    minVitals: played.minVitals,
    // Cast and move counts are not exposed by the play session; null rather than a guess.
    ...(played.seatLog ? { driver: "seat", seat: played.seat ?? null, seatLog: played.seatLog } : played.t1 ? { driver: "t1-contact", t1: played.t1 } : { driver: "t0" }),
    castCount: null,
    moveCount: null,
    delverPool: delverPool(built.dir),
    build: { fingerprint, actors },
    ruleHits: ruleHits(scenario, built.args, built.dir, played),
  };
}

export async function runPlaySim({ scenarios, seeds = DEFAULT_SEEDS, outDir, baseline = true, treatment = true, strategy = "dash", maxTicks = DEFAULT_MAX_TICKS, llm = null, picker = null, seatPicker = null, transport = null, model = null, log = () => {} } = {}) {
  const catalog = loadPlaytestScenarios();
  const picked = (scenarios?.length ? scenarios : catalog.scenarios.map((entry) => entry.id)).map((id) => {
    const found = catalog.scenarios.find((entry) => entry.id === id);
    if (!found) throw new Error(`no playtest scenario "${id}"`);
    return found;
  });
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "ak-play-sim-"));
  const runs = [];
  try {
    for (const scenario of picked) {
      for (const seed of seeds) {
        for (const armSpec of armBudgets(scenario, { baseline, treatment })) {
          const record = await runOne(scenario, seed, armSpec, { workDir, createdAt: catalog.createdAt, strategy, maxTicks, llm, picker, seatPicker, transport });
          const file = `${scenario.id}-s${seed}-${armSpec.arm}.json`;
          writeFileSync(join(outDir, file), `${JSON.stringify(record, null, 2)}\n`);
          runs.push({ file, ...record });
          log(`${scenario.id} s${seed} ${armSpec.arm}: ${record.outcome} in ${record.ticks} ticks${record.ruleHits.length ? `, ${record.ruleHits.length} rule hit(s)` : ""}`);
        }
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  const usedModel = Boolean(llm || picker || seatPicker);
  // A model run is a probe, like a benchmark --local run: never a qualifying baseline, never a gate.
  const summary = { schema: "agent-kernel/PlaySimRun", version: 1, strategy, seeds, maxTicks,
    ...(usedModel ? { matrix: "local-unversioned", model } : {}),
    runs: runs.map(({ file, scenario, seed, arm, outcome, ticks, ruleHits: hits }) => ({ file, scenario, seed, arm, outcome, ticks, ruleHits: hits.map((hit) => hit.rule) })) };
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return { outDir, runs, summary };
}

function parseArgs(argv) {
  const options = { baseline: true, treatment: true, strategy: "dash", maxTicks: DEFAULT_MAX_TICKS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenarios") options.scenarios = argv[++i].split(",").filter(Boolean);
    else if (arg === "--seeds") options.seeds = argv[++i].split(",").filter(Boolean).map(Number);
    else if (arg === "--out-dir") options.outDir = resolve(argv[++i]);
    else if (arg === "--baseline-only") options.treatment = false;
    else if (arg === "--treatment-only") options.baseline = false;
    else if (arg === "--strategy") options.strategy = argv[++i];
    else if (arg === "--max-ticks") options.maxTicks = Number(argv[++i]);
    else if (arg === "--driver") options.driver = argv[++i];
    else if (arg === "--build-source") options.buildSource = argv[++i];
    else if (arg === "--model") options.model = argv[++i];
    else if (arg === "--ollama-url") options.ollamaUrl = argv[++i];
    else if (arg === "--provider") options.provider = argv[++i];
    else throw new Error(`unknown option ${arg}`);
  }
  if (!options.baseline && !options.treatment) throw new Error("--baseline-only and --treatment-only exclude each other");
  if (options.seeds?.some((seed) => !Number.isInteger(seed))) throw new Error("--seeds takes integers");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const outDir = options.outDir ?? join(ROOT, "artifacts/play-sim", runId);
    const { model, baseUrl } = resolveModelEnv(options);
    const { provider, apiKey } = resolveProvider(options.provider);
    const adapterFor = async () => {
      if (provider === "anthropic") return createAnthropicAdapter({ apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined });
      const { createLlmAdapter } = await import("../../packages/adapters-cli/src/adapters/llm/index.js");
      return createLlmAdapter(baseUrl ? { baseUrl } : {});
    };
    let llm = null;
    let picker = null;
    let seatPicker = null;
    if (options.buildSource === "llm") {
      if (!model) throw new Error("--build-source llm needs --model (or OLLAMA_MODEL)");
      llm = { model, adapter: await adapterFor() };
    } else if (options.buildSource && options.buildSource !== "default") throw new Error(`unknown --build-source ${options.buildSource} (default or llm)`);
    if (options.driver === "t1-contact") {
      if (!model) throw new Error("--driver t1-contact needs --model (or OLLAMA_MODEL)");
      picker = llmPicker({ adapter: await adapterFor(), model });
    } else if (options.driver === "seat") {
      if (!model) throw new Error("--driver seat needs --model (or OLLAMA_MODEL)");
      seatPicker = llmSeatPicker({ adapter: await adapterFor(), model });
    } else if (options.driver && options.driver !== "t0") throw new Error(`unknown --driver ${options.driver} (t0, t1-contact or seat)`);
    if (llm || picker || seatPicker) console.log(provider === "anthropic" ? `model ${model} via the Anthropic API` : `model ${model} at ${baseUrl ?? "the adapter default (localhost:11434)"}`);
    const { summary } = await runPlaySim({ ...options, model, llm, picker, seatPicker, outDir, log: (line) => console.log(line) });
    console.log(`Wrote ${summary.runs.length} run(s) to ${outDir}`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
