/**
 * Power ladder (Darren, 2026-11-03): how overpowered must an AI-seated delver be to win a level?
 *
 * The scenario's own playable delver is scaled rung by rung (×1, ×1.5, ×2, ...) and each rung is
 * played by the seat driver (a model choosing from the legal list, as `play-sim --driver seat`).
 * The map, the wardens and the rest of the level stay the scenario's: only the delver changes,
 * and the Allocator prices every rung through `ak create` (a rung whose delver the arm cannot
 * afford is rebuilt at a doubled budget, which leaves the map unchanged; its receipt is recorded).
 *
 *   node scripts/testing/play-sim-power-ladder.mjs --model qwen3.8:27b [--scenario first-look]
 *        [--seeds 0,1] [--rungs 1,1.5,2,3,4] [--max-ticks 200] [--provider ollama|anthropic] [--ollama-url URL]
 *
 * Scaling a rung by k: every vital's max and regen × k (rounded up); each push and pull's intensity
 * × √k (rounded, at least 1), since harm and mana both grow with intensity²; emits and ranges stay.
 * Writes artifacts/play-sim/power-ladder-<run-id>/{rung-<k>-s<seed>.json, summary.json, report.md}.
 * A probe, like any model run: never a gate.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaytestScenarios, playerDelverSpec } from "../game/playtest.mjs";
import { runOne } from "./play-sim.mjs";
import { resolveModelEnv } from "./play-sim-model-env.mjs";
import { llmSeatPicker } from "./play-sim-seat.mjs";
import { createAnthropicAdapter, resolveProvider } from "./play-sim-anthropic.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_RUNGS = [1, 1.5, 2, 3, 4];
const BUDGET_RETRIES = 3;

/** The delver spec scaled by `k` (see the header); every other field is kept as written. */
export function scaleDelverSpec(spec, k) {
  if (!(k > 0)) throw new Error(`a rung must be positive, got ${k}`);
  return spec.split(";").map((field) => {
    const [key, value] = field.split("=");
    if (key === "vitals") {
      return `vitals=${value.split(",").map((entry) => {
        const [name, max, regen = "0"] = entry.split(":");
        return `${name}:${Math.ceil(Number(max) * k)}:${Math.ceil(Number(regen) * k)}`;
      }).join(",")}`;
    }
    if (key === "affinities") {
      return `affinities=${value.split(",").map((entry) => {
        const [kind, expression, range, intensity = "1"] = entry.split(":");
        const scaled = expression === "push" || expression === "pull" ? Math.max(1, Math.round(Number(intensity) * Math.sqrt(k))) : Number(intensity);
        return `${kind}:${expression}:${range}:${scaled}`;
      }).join(",")}`;
    }
    return field;
  }).join(";");
}

/** Play every rung on every seed; returns `{ outDir, runs, summary }`. */
export async function runPowerLadder({ scenarioId = "first-look", seeds = [0], rungs = DEFAULT_RUNGS, maxTicks = 200, seatPicker, model = null, outDir, log = () => {} }) {
  const catalog = loadPlaytestScenarios();
  const scenario = catalog.scenarios.find((entry) => entry.id === scenarioId);
  if (!scenario) throw new Error(`no playtest scenario "${scenarioId}"`);
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "ak-power-ladder-"));
  const runs = [];
  try {
    for (const seed of seeds) {
      const baseSpec = playerDelverSpec(scenario, seed);
      for (const k of rungs) {
        const character = scaleDelverSpec(baseSpec, k);
        let budgetTokens = Math.ceil(scenario.budgetTokens * Math.max(1, k));
        let record;
        for (let attempt = 0; attempt <= BUDGET_RETRIES; attempt += 1) {
          record = await runOne({ ...scenario, id: `${scenario.id}-x${k}` }, seed, { arm: "baseline", budgetTokens },
            { workDir, createdAt: catalog.createdAt, strategy: "seat", maxTicks, seatPicker, character });
          if (record.outcome !== "create_failed") break;
          budgetTokens *= 2;
        }
        const entry = { rung: k, character, ...record };
        const file = `rung-${k}-s${seed}.json`;
        writeFileSync(join(outDir, file), `${JSON.stringify(entry, null, 2)}\n`);
        runs.push({ file, rung: k, seed, outcome: record.outcome, ticks: record.ticks, budgetTokens,
          delverTokens: record.delverPool?.spentTokens ?? null, minHealth: record.minVitals?.health ?? null,
          illegal: record.seatLog?.illegal ?? null });
        log(`x${k} s${seed}: ${record.outcome} in ${record.ticks} ticks (delver ${record.delverPool?.spentTokens ?? "?"} tokens)`);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  const won = runs.filter((run) => run.outcome === "exited").map((run) => run.rung);
  const summary = { schema: "agent-kernel/PowerLadderRun", version: 1, scenario: scenarioId, seeds, rungs, maxTicks, model,
    lowestWinningRung: won.length ? Math.min(...won) : null, runs };
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const rows = runs.map((run) => `| ×${run.rung} | ${run.seed} | ${run.outcome} | ${run.ticks} | ${run.delverTokens ?? "?"} | ${run.budgetTokens} | ${run.minHealth ?? "?"} | ${run.illegal ?? "?"} |`);
  writeFileSync(join(outDir, "report.md"), [`# Power ladder: ${scenarioId}`, "", `Model: ${model ?? "fixture"} · lowest winning rung: ${summary.lowestWinningRung === null ? "none" : `×${summary.lowestWinningRung}`}`, "",
    "| rung | seed | outcome | ticks | delver tokens | budget | min HP | illegal |", "|---|---|---|---|---|---|---|---|", ...rows, ""].join("\n"));
  return { outDir, runs, summary };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenario") options.scenarioId = argv[++i];
    else if (arg === "--seeds") options.seeds = argv[++i].split(",").filter(Boolean).map(Number);
    else if (arg === "--rungs") options.rungs = argv[++i].split(",").filter(Boolean).map(Number);
    else if (arg === "--max-ticks") options.maxTicks = Number(argv[++i]);
    else if (arg === "--out-dir") options.outDir = resolve(argv[++i]);
    else if (arg === "--model") options.model = argv[++i];
    else if (arg === "--ollama-url") options.ollamaUrl = argv[++i];
    else if (arg === "--provider") options.provider = argv[++i];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (options.rungs?.some((k) => !(k > 0))) throw new Error("--rungs takes positive numbers");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const outDir = options.outDir ?? join(ROOT, "artifacts/play-sim", `power-ladder-${runId}`);
    const { model, baseUrl } = resolveModelEnv(options);
    if (!model) throw new Error("the power ladder needs --model (or OLLAMA_MODEL)");
    const { provider, apiKey } = resolveProvider(options.provider);
    const adapter = provider === "anthropic"
      ? createAnthropicAdapter({ apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined })
      : (await import("../../packages/adapters-cli/src/adapters/llm/index.js")).createLlmAdapter(baseUrl ? { baseUrl } : {});
    console.log(provider === "anthropic" ? `model ${model} via the Anthropic API` : `model ${model} at ${baseUrl ?? "the adapter default (localhost:11434)"}`);
    const { summary } = await runPowerLadder({ ...options, model, outDir, seatPicker: llmSeatPicker({ adapter, model }), log: (line) => console.log(line) });
    console.log(`Lowest winning rung: ${summary.lowestWinningRung === null ? "none" : `x${summary.lowestWinningRung}`}. Wrote ${outDir}`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
