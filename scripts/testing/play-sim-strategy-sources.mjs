#!/usr/bin/env node
/**
 * Strategy sources compared by play-sim outcome (#677, tracker #611, AI S1).
 *
 * "Strategy" here is the dungeon configuration. The same scenario, seed and token budget are
 * built twice through `ak create`, differing only in who picked the placement tactics:
 *
 *   catalogue   `--tactic auto`: the Director's seeded pick from the tactic catalogue (#395)
 *   llm         `--tactic llm`: a model's plan (--fixture, or AK_LLM_LIVE=1 with --model / --base-url)
 *
 * Every level goes through `ak create` and the Allocator; nothing is hand-priced. Both are played
 * by the same T0 driver (the seated delver is ordered to the exit) and compared on progress
 * (exits and ticks to exit), deaths, and loops (a timeout: the delver never reached the exit,
 * which is what a stall or a loop looks like to a fixed order). Read-only analysis: no engine
 * changes, never a merge gate, and a model run is a probe, not a baseline.
 *
 * `--tactic llm` falls back to the seeded plan when there is no model or the reply is invalid; the
 * result's `tacticPlan.decidedBy` says which decided. A pair where the model did not decide is
 * reported as `fellBack` and left out of the comparison, so "llm" never silently means "catalogue".
 *
 *   node scripts/testing/play-sim-strategy-sources.mjs --scenarios first-look,duel --seeds 0,1
 *     [--model <id> --base-url <url>]   (sets AK_LLM_LIVE=1 for the llm source)
 *     [--fixture <tactic-plan.json>]    (a recorded reply instead of a model)
 *     [--strategy dash|fight] [--max-ticks N] [--out-dir dir]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaytestScenarios, scenarioArgs } from "../../packages/adapters-cli/src/cli/playtest-scenarios.mjs";
import { DEFAULT_MAX_TICKS, DEFAULT_SEEDS, playArm } from "./play-sim.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

export const SOURCES = Object.freeze(["catalogue", "llm"]);

/** `--tactic` pairs make a level's tactics the scenario's own; a source's pick only replaces none. */
export const hasOwnTactic = (scenario) => scenario.args.includes("--tactic");

/** The `ak create` arguments that differ by source. */
export function sourceArgs(source, { fixture, model, baseUrl } = {}) {
  if (source === "catalogue") return ["--tactic", "auto"];
  if (source === "llm") {
    return ["--tactic", "llm", ...(fixture ? ["--fixture", fixture] : []), ...(model ? ["--model", model] : []), ...(baseUrl ? ["--base-url", baseUrl] : [])];
  }
  throw new Error(`unknown strategy source "${source}" (${SOURCES.join(" or ")})`);
}

function create(args, env = {}) {
  const run = spawnSync(process.execPath, [AK, "create", ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env },
  });
  if (run.status !== 0) return { ok: false, error: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().slice(0, 500) };
  try { return { ok: true, result: JSON.parse(run.stdout) }; } catch { return { ok: false, error: "create printed no JSON" }; }
}

/** Build and play one scenario, seed and source. */
export async function runSource(scenario, seed, source, { workDir, createdAt, strategy = "dash", maxTicks = DEFAULT_MAX_TICKS, fixture, model, baseUrl }) {
  const base = { scenario: scenario.id, seed, source, budgetTokens: scenario.budgetTokens };
  const dir = join(workDir, `${scenario.id}-s${seed}-${source}`);
  const args = ["--run-id", `strategy-${scenario.id}-s${seed}-${source}`, "--created-at", createdAt,
    ...scenarioArgs(scenario, seed), "--seed", String(seed), ...sourceArgs(source, { fixture, model, baseUrl }), "--out-dir", dir];
  const built = create(args, source === "llm" && !fixture ? { AK_LLM_LIVE: "1" } : {});
  if (!built.ok) return { ...base, outcome: "create_failed", ticks: 0, error: built.error };
  const plan = built.result.tacticPlan ?? null;
  const tactics = (built.result.tactics ?? []).map((entry) => entry.tactic);
  const played = await playArm(dir, { strategy, maxTicks });
  const spent = built.result.cost?.totalSpend ?? null;
  return {
    ...base, outcome: played.outcome, ticks: played.ticks, minVitals: played.minVitals ?? {}, spentTokens: spent,
    tactics, decidedBy: plan?.decidedBy ?? null, ...(plan?.reasons ? { reasons: plan.reasons } : {}),
  };
}

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Per-source totals over the runs it counts. */
export function summarize(runs) {
  const n = runs.length;
  const exited = runs.filter((run) => run.outcome === "exited");
  return {
    runs: n,
    exited: exited.length,
    defeated: runs.filter((run) => run.outcome === "defeated").length,
    loops: runs.filter((run) => run.outcome === "timeout").length,
    failed: runs.filter((run) => run.outcome === "create_failed").length,
    medianTicksToExit: median(exited.map((run) => run.ticks)),
  };
}

/**
 * The comparison: runs paired by scenario and seed. A pair counts only when both built and the
 * model really decided the llm side; the rest are listed as `fellBack` or `unpaired`.
 */
export function compare(runs) {
  const key = (run) => `${run.scenario}#${run.seed}`;
  const pairs = new Map();
  for (const run of runs) pairs.set(key(run), { ...pairs.get(key(run)), [run.source]: run });
  const counted = [];
  const fellBack = [];
  const unpaired = [];
  for (const [id, pair] of pairs) {
    if (!pair.catalogue || !pair.llm || pair.catalogue.outcome === "create_failed" || pair.llm.outcome === "create_failed") unpaired.push(id);
    else if (pair.llm.decidedBy !== "llm") fellBack.push({ pair: id, reasons: pair.llm.reasons ?? [] });
    else counted.push(pair);
  }
  return {
    pairsCounted: counted.length,
    fellBack,
    unpaired,
    catalogue: summarize(counted.map((pair) => pair.catalogue)),
    llm: summarize(counted.map((pair) => pair.llm)),
    sameTactics: counted.filter((pair) => JSON.stringify(pair.catalogue.tactics) === JSON.stringify(pair.llm.tactics)).length,
  };
}

/** A short Markdown report. */
export function renderReport({ runs, comparison, model, fixture, strategy, maxTicks }) {
  const cell = (value) => (value === null || value === undefined ? "n/a" : String(value));
  const rows = (name, s) => `| ${name} | ${s.runs} | ${s.exited} | ${s.defeated} | ${s.loops} | ${cell(s.medianTicksToExit)} |`;
  const lines = [
    "# Strategy sources compared (#677)",
    "",
    `Same scenario, seed and token budget; only the placement-tactic source differs. Driver: T0 \`${strategy}\`, max ${maxTicks} ticks. ${fixture ? `llm source: recorded reply \`${fixture}\`.` : model ? `llm source: ${model}.` : "No model was given, so the llm source fell back to the seeded plan."} A probe, never a gate.`,
    "",
    `Pairs counted: ${comparison.pairsCounted}. The model decided the llm side in those only; ${comparison.fellBack.length} fell back to the seeded plan and ${comparison.unpaired.length} did not build.`,
    "",
    "| Source | Runs | Exited | Defeated | Loops (timeout) | Median ticks to exit |",
    "|---|---|---|---|---|---|",
    rows("catalogue (`--tactic auto`)", comparison.catalogue),
    rows("llm (`--tactic llm`)", comparison.llm),
    "",
    `Pairs where both sources chose the same tactics: ${comparison.sameTactics} of ${comparison.pairsCounted}.`,
  ];
  if (comparison.fellBack.length) {
    lines.push("", "Fell back (not compared):", ...comparison.fellBack.map((entry) => `- ${entry.pair}: ${entry.reasons.join("; ") || "no reason given"}`));
  }
  if (comparison.unpaired.length) lines.push("", `Did not build: ${comparison.unpaired.join(", ")}.`);
  lines.push("", "Runs:", ...runs.map((run) => `- ${run.scenario} s${run.seed} ${run.source}: ${run.outcome} in ${run.ticks} ticks; tactics ${run.tactics?.join("+") || "none"}${run.decidedBy ? ` (decided by ${run.decidedBy})` : ""}`));
  return `${lines.join("\n")}\n`;
}

export async function runStrategySources({ scenarios, seeds = DEFAULT_SEEDS, outDir, strategy = "dash", maxTicks = DEFAULT_MAX_TICKS, fixture, model, baseUrl, log = () => {} } = {}) {
  const catalog = loadPlaytestScenarios();
  const picked = (scenarios?.length ? scenarios : catalog.scenarios.map((entry) => entry.id)).map((id) => {
    const found = catalog.scenarios.find((entry) => entry.id === id);
    if (!found) throw new Error(`no playtest scenario "${id}"`);
    return found;
  });
  const own = picked.filter(hasOwnTactic);
  if (own.length) log(`skipping ${own.map((entry) => entry.id).join(", ")}: the scenario fixes its own --tactic`);
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "ak-strategy-sources-"));
  const runs = [];
  try {
    for (const scenario of picked.filter((entry) => !hasOwnTactic(entry))) {
      for (const seed of seeds) {
        for (const source of SOURCES) {
          const record = await runSource(scenario, seed, source, { workDir, createdAt: catalog.createdAt, strategy, maxTicks, fixture, model, baseUrl });
          runs.push(record);
          log(`${scenario.id} s${seed} ${source}: ${record.outcome} in ${record.ticks} ticks${record.decidedBy ? ` (${record.decidedBy})` : ""}`);
        }
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  const comparison = compare(runs);
  const summary = { schema: "agent-kernel/PlaySimStrategySources", version: 1, strategy, seeds, maxTicks,
    matrix: "local-unversioned", ...(model ? { model } : {}), ...(fixture ? { fixture } : {}), comparison, runs };
  writeFileSync(join(outDir, "strategy-sources.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outDir, "strategy-sources.md"), renderReport({ runs, comparison, model, fixture, strategy, maxTicks }));
  return { outDir, runs, comparison };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenarios") options.scenarios = argv[++i].split(",").filter(Boolean);
    else if (arg === "--seeds") options.seeds = argv[++i].split(",").filter(Boolean).map(Number);
    else if (arg === "--strategy") options.strategy = argv[++i];
    else if (arg === "--max-ticks") options.maxTicks = Number(argv[++i]);
    else if (arg === "--out-dir") options.outDir = resolve(argv[++i]);
    else if (arg === "--fixture") options.fixture = resolve(argv[++i]);
    else if (arg === "--model") options.model = argv[++i];
    else if (arg === "--base-url") options.baseUrl = argv[++i];
    else throw new Error(`unknown option ${arg}`);
  }
  if (options.seeds?.some((seed) => !Number.isInteger(seed))) throw new Error("--seeds takes integers");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const outDir = options.outDir ?? join(ROOT, "artifacts/play-sim", `strategy-sources-${runId}`);
    const { comparison } = await runStrategySources({ ...options, outDir, log: (line) => console.log(line) });
    console.log(`Wrote the report to ${outDir}/strategy-sources.md (${comparison.pairsCounted} pair(s) compared)`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
