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
 *        [--seeds 0,1] [--rungs 1,1.5,2,3,4] [--repeats 3] [--max-ticks 200] [--provider ollama|anthropic] [--ollama-url URL]
 *
 * v2 (2026-11-04): one play is a sample, not a verdict (×1.5 won and ×2 lost on one seed), so each
 * rung is played `--repeats` times per seed. Each play is labelled from what the seat saw: `fought`
 * (it cast), `pinned` (defeated at 0 stamina), `avoided` (left without casting), `lost` or `timeout`,
 * with its kit use (equips, casts, landed hits), damage taken (health lost, from its HUD) and turns the
 * guard was in sight. The summary gives each rung's win rate and tokens per win.
 *
 * Scaling a rung by k: every vital's max and regen × k (rounded up); each push and pull's intensity
 * × √k (rounded, at least 1), since harm and mana both grow with intensity²; emits and ranges stay.
 * Writes artifacts/play-sim/power-ladder-<run-id>/{rung-<k>-s<seed>-r<n>.json, summary.json, report.md}.
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
export const DEFAULT_REPEATS = 3;
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

/** Health the seat lost over the play, summed from its HUD line per turn (its own vitals: #497 allows). */
function healthLost(transcript) {
  let lost = 0;
  let before = null;
  for (const turn of transcript) {
    const now = Number(/HP (\d+)\//.exec(turn.hud ?? "")?.[1]);
    if (Number.isFinite(now) && before !== null && now < before) lost += before - now;
    if (Number.isFinite(now)) before = now;
  }
  return lost;
}

/** What one play shows about the seat's play, from the seat's own record (no fog-free reads). */
export function playProfile(record) {
  const transcript = record.seatLog?.transcript ?? [];
  const picks = transcript.map((turn) => turn.pick);
  const casts = picks.filter((pick) => pick.startsWith("cast")).length;
  const struck = new Set(transcript.flatMap((turn) => (turn.screen ?? "").split("\n"))
    .filter((line) => /^\s*T\d+ You cast .* and struck /.test(line)).map((line) => line.trim())).size;
  const last = transcript.at(-1)?.hud ?? "";
  const pinned = record.outcome === "defeated" && / ST 0\//.test(last);
  const label = casts > 0 ? "fought" : pinned ? "pinned" : record.outcome === "exited" ? "avoided"
    : record.outcome === "defeated" ? "lost" : record.outcome;
  return { label, equips: picks.filter((pick) => pick.startsWith("equip")).length, casts, struck,
    healthLost: healthLost(transcript), hostileInSightTurns: transcript.filter((turn) => /In sight: .*\bW\d/.test(turn.screen ?? "")).length };
}

/** Play every rung on every seed, `repeats` times; returns `{ outDir, runs, summary }`. */
export async function runPowerLadder({ scenarioId = "first-look", seeds = [0], rungs = DEFAULT_RUNGS, repeats = DEFAULT_REPEATS, maxTicks = 200, seatPicker, model = null, outDir, log = () => {} }) {
  const catalog = loadPlaytestScenarios();
  const scenario = catalog.scenarios.find((entry) => entry.id === scenarioId);
  if (!scenario) throw new Error(`no playtest scenario "${scenarioId}"`);
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "ak-power-ladder-"));
  const runs = [];
  // report.md and summary.json are rewritten after every play, so a run in progress can be read
  // (`watch -n 10 cat .../report.md`); the last write is the final report.
  const writeReports = () => {
    const byRung = rungs.map((k) => {
      const plays = runs.filter((run) => run.rung === k);
      const wins = plays.filter((run) => run.outcome === "exited").length;
      const tokens = plays.find((run) => Number.isFinite(run.delverTokens))?.delverTokens ?? null;
      const mean = (key) => (plays.length ? Math.round((plays.reduce((sum, run) => sum + (run[key] ?? 0), 0) / plays.length) * 10) / 10 : null);
      const labels = Object.fromEntries(["fought", "avoided", "pinned", "lost", "timeout"].map((label) => [label, plays.filter((run) => run.label === label).length]).filter(([, n]) => n));
      return { rung: k, plays: plays.length, wins, winRate: plays.length ? wins / plays.length : null, delverTokens: tokens,
        tokensPerWin: wins ? Math.round((tokens ?? 0) * plays.length / wins) : null, meanTicks: mean("ticks"), meanCasts: mean("casts"), meanHealthLost: mean("healthLost"), labels };
    });
    const winning = byRung.filter((rung) => rung.winRate !== null && rung.winRate >= 0.5).map((rung) => rung.rung);
    const summary = { schema: "agent-kernel/PowerLadderRun", version: 2, scenario: scenarioId, seeds, rungs, repeats, maxTicks, model,
      lowestWinningRung: winning.length ? Math.min(...winning) : null, byRung, runs };
    writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    const rows = byRung.map((rung) => `| ×${rung.rung} | ${rung.wins}/${rung.plays} | ${rung.delverTokens ?? "?"} | ${rung.tokensPerWin ?? "–"} | ${rung.meanTicks} | ${rung.meanCasts} | ${rung.meanHealthLost} | ${Object.entries(rung.labels).map(([label, n]) => `${label} ${n}`).join(", ")} |`);
    const plays = runs.map((run) => `| ×${run.rung} | ${run.seed} | ${run.repeat} | ${run.outcome} | ${run.label} | ${run.ticks} | ${run.casts} | ${run.struck} | ${run.healthLost} | ${run.hostileInSightTurns} | ${run.illegal ?? "?"} |`);
    writeFileSync(join(outDir, "report.md"), [`# Power ladder: ${scenarioId}`, "",
      `Model: ${model ?? "fixture"} · ${repeats} play(s) per rung and seed · lowest rung winning at least half its plays: ${summary.lowestWinningRung === null ? "none" : `×${summary.lowestWinningRung}`}`, "",
      "| rung | wins | delver tokens | tokens per win | mean ticks | mean casts | mean HP lost | how |", "|---|---|---|---|---|---|---|---|", ...rows, "",
      "## Plays", "", "| rung | seed | play | outcome | how | ticks | casts | hits landed | HP lost | turns hostile in sight | illegal |", "|---|---|---|---|---|---|---|---|---|---|---|", ...plays, ""].join("\n"));
    return summary;
  };
  try {
    for (const seed of seeds) {
      const baseSpec = playerDelverSpec(scenario, seed);
      for (const k of rungs) {
        const character = scaleDelverSpec(baseSpec, k);
        for (let repeat = 1; repeat <= repeats; repeat += 1) {
          let budgetTokens = Math.ceil(scenario.budgetTokens * Math.max(1, k));
          let record;
          for (let attempt = 0; attempt <= BUDGET_RETRIES; attempt += 1) {
            record = await runOne({ ...scenario, id: `${scenario.id}-x${k}` }, seed, { arm: "baseline", budgetTokens },
              { workDir, createdAt: catalog.createdAt, strategy: "seat", maxTicks, seatPicker, character });
            if (record.outcome !== "create_failed") break;
            budgetTokens *= 2;
          }
          const profile = playProfile(record);
          const file = `rung-${k}-s${seed}-r${repeat}.json`;
          writeFileSync(join(outDir, file), `${JSON.stringify({ rung: k, repeat, character, profile, ...record }, null, 2)}\n`);
          runs.push({ file, rung: k, seed, repeat, outcome: record.outcome, ticks: record.ticks, budgetTokens,
            delverTokens: record.delverPool?.spentTokens ?? null, minHealth: record.minVitals?.health ?? null,
            illegal: record.seatLog?.illegal ?? null, ...profile });
          writeReports();
          log(`x${k} s${seed} r${repeat}: ${record.outcome} (${profile.label}) in ${record.ticks} ticks, ${profile.casts} casts, -${profile.healthLost} HP (delver ${record.delverPool?.spentTokens ?? "?"} tokens)`);
        }
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  const summary = writeReports();
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
    else if (arg === "--repeats") options.repeats = Number(argv[++i]);
    else if (arg === "--out-dir") options.outDir = resolve(argv[++i]);
    else if (arg === "--model") options.model = argv[++i];
    else if (arg === "--ollama-url") options.ollamaUrl = argv[++i];
    else if (arg === "--provider") options.provider = argv[++i];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (options.rungs?.some((k) => !(k > 0))) throw new Error("--rungs takes positive numbers");
  if (options.repeats !== undefined && !(Number.isInteger(options.repeats) && options.repeats > 0)) throw new Error("--repeats takes a positive integer");
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
