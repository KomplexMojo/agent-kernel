/**
 * Recipe ladder (#725): each configuration recipe played as the scenario's delver, once per
 * strategy recipe it pairs with (design section 4) and once with plain `fight` as the baseline,
 * so a recipe's win rate and tokens per win sit beside the scenario's own delver.
 *
 * The delver is `recipe=<name>;motivation=user_controlled`, priced by the Allocator through
 * `ak create` like any spec (a delver the arm cannot afford is rebuilt at a doubled budget; the
 * map is unchanged). It is played by the T0 driver, not a model: the delver is ordered
 * `{ goals: [reach exit], tactics: <the strategy recipe's tactics> }` (the recipe's own goals when
 * it has any), so the run is deterministic and needs no model. A seat driver would ignore the
 * strategy (a seat commands every turn), which is why this ladder does not take one.
 *
 *   node scripts/testing/play-sim-recipe-ladder.mjs [--scenario first-look] [--recipes tank,kiter] [--seeds 0,1,2] [--max-ticks 200]
 *
 * Flags each recipe's outliers: a defeat at 0 stamina (a pin), a pure-support recipe that never wins
 * alone, and a recipe whose best strategy wins more than the baseline delver by half or more.
 * Writes artifacts/play-sim/recipe-ladder-<run-id>/{summary.json, report.md}. A probe: never a gate.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaytestScenarios, playerDelverSpec } from "../../packages/adapters-cli/src/cli/playtest-scenarios.mjs";
import { runOne, strategyFor } from "./play-sim.mjs";
import { createConfiguratorPersona } from "../../packages/runtime/src/personas/configurator/persona.js";
import { actorStrategyRecipe } from "../../packages/runtime/src/personas/actor/persona.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUDGET_RETRIES = 3;
const EXIT = Object.freeze({ kind: "reach", place: "exit" });

/** The T0 order for a strategy recipe: its tactics, and its goals or else the exit. */
export function recipeOrder(strategyName) {
  if (strategyName === "fight") return strategyFor("fight");
  const { strategy } = actorStrategyRecipe(strategyName);
  return { goals: strategy.goals.length > 0 ? strategy.goals : [EXIT], ...(strategy.tactics ? { tactics: strategy.tactics } : {}) };
}

/** Each configuration recipe with the strategies it is played under: its pairings, then `fight`. */
export function recipePlan(names) {
  const rows = createConfiguratorPersona({ clock: () => "2026-11-04T00:00:00.000Z" }).describeConfigurationRecipes();
  const known = new Set(rows.map((row) => row.name));
  const unknown = (names ?? []).filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`unknown recipe ${unknown.join(", ")} (known: ${[...known].join(", ")})`);
  return rows.filter((row) => !names || names.includes(row.name))
    .map((row) => ({ name: row.name, roles: row.roles, strategies: [...row.strategies, "fight"] }));
}

const pinned = (record) => record.outcome === "defeated" && record.minVitals?.stamina === 0;

export async function runRecipeLadder({ scenarioId = "first-look", seeds = [0], recipes, maxTicks = 200, outDir, log = () => {} }) {
  const catalog = loadPlaytestScenarios();
  const scenario = catalog.scenarios.find((entry) => entry.id === scenarioId);
  if (!scenario) throw new Error(`no playtest scenario "${scenarioId}"`);
  mkdirSync(outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "ak-recipe-ladder-"));
  const runs = [];
  const play = async (label, character, strategy, seed) => {
    let budgetTokens = scenario.budgetTokens;
    let record;
    for (let attempt = 0; attempt <= BUDGET_RETRIES; attempt += 1) {
      record = await runOne({ ...scenario, id: `${scenario.id}-${label}` }, seed, { arm: "baseline", budgetTokens },
        { workDir, createdAt: catalog.createdAt, strategy: recipeOrder(strategy), maxTicks, character });
      if (record.outcome !== "create_failed") break;
      budgetTokens *= 2;
    }
    const run = { recipe: label, strategy, seed, outcome: record.outcome, ticks: record.ticks, budgetTokens,
      delverTokens: record.delverPool?.spentTokens ?? null, minHealth: record.minVitals?.health ?? null,
      minStamina: record.minVitals?.stamina ?? null, pinned: pinned(record),
      ...(record.ruleHits?.some((hit) => hit.rule === "create_failed") ? { error: record.ruleHits.find((hit) => hit.rule === "create_failed").detail } : {}) };
    runs.push(run);
    log(`${label} / ${strategy} s${seed}: ${run.outcome} in ${run.ticks} ticks (delver ${run.delverTokens ?? "?"} t${run.pinned ? ", pinned" : ""})`);
    return run;
  };
  const plan = recipePlan(recipes);
  try {
    for (const seed of seeds) await play("baseline", playerDelverSpec(scenario, seed), "fight", seed);
    for (const recipe of plan) {
      for (const strategy of recipe.strategies) {
        for (const seed of seeds) await play(recipe.name, `recipe=${recipe.name};motivation=user_controlled`, strategy, seed);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  const rate = (plays) => (plays.length ? plays.filter((run) => run.outcome === "exited").length / plays.length : null);
  const baselineRate = rate(runs.filter((run) => run.recipe === "baseline"));
  const rows = [{ name: "baseline", roles: null, strategies: ["fight"] }, ...plan].flatMap((recipe) => recipe.strategies.map((strategy) => {
    const plays = runs.filter((run) => run.recipe === recipe.name && run.strategy === strategy);
    const wins = plays.filter((run) => run.outcome === "exited").length;
    const tokens = plays.find((run) => Number.isFinite(run.delverTokens))?.delverTokens ?? null;
    return { recipe: recipe.name, strategy, plays: plays.length, wins, winRate: rate(plays), delverTokens: tokens,
      tokensPerWin: wins ? Math.round((tokens ?? 0) * plays.length / wins) : null,
      pins: plays.filter((run) => run.pinned).length, outcomes: plays.map((run) => run.outcome) };
  }));
  const flags = [];
  for (const recipe of plan) {
    const mine = rows.filter((row) => row.recipe === recipe.name);
    const best = Math.max(...mine.map((row) => row.winRate ?? 0));
    const pins = mine.reduce((sum, row) => sum + row.pins, 0);
    if (pins > 0) flags.push(`${recipe.name}: ${pins} defeat(s) at 0 stamina (pinned).`);
    if (recipe.roles.attack === 0 && best === 0) flags.push(`${recipe.name}: pure support, never wins alone (needs an escort or an ally).`);
    if (baselineRate !== null && best - baselineRate >= 0.5) flags.push(`${recipe.name}: wins ${Math.round(best * 100)}% against the baseline's ${Math.round(baselineRate * 100)}%.`);
    if (mine.some((row) => row.plays > 0 && row.outcomes.every((outcome) => outcome === "create_failed"))) flags.push(`${recipe.name}: could not be built.`);
  }
  const summary = { schema: "agent-kernel/RecipeLadderRun", version: 1, scenario: scenarioId, seeds, maxTicks, baselineWinRate: baselineRate, flags, rows, runs };
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const pct = (value) => (value === null ? "–" : `${Math.round(value * 100)}%`);
  writeFileSync(join(outDir, "report.md"), [`# Recipe ladder: ${scenarioId}`, "",
    `T0 driver (no model) · seeds ${seeds.join(", ")} · baseline delver wins ${pct(baselineRate)}`, "",
    ...(flags.length ? ["## Flags", "", ...flags.map((flag) => `- ${flag}`), ""] : []),
    "| recipe | strategy | wins | win rate | delver tokens | tokens per win | pins | outcomes |", "|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.recipe} | ${row.strategy} | ${row.wins}/${row.plays} | ${pct(row.winRate)} | ${row.delverTokens ?? "?"} | ${row.tokensPerWin ?? "–"} | ${row.pins} | ${row.outcomes.join(", ")} |`), ""].join("\n"));
  return { outDir, summary };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenario") options.scenarioId = argv[++i];
    else if (arg === "--seeds") options.seeds = argv[++i].split(",").filter(Boolean).map(Number);
    else if (arg === "--recipes") options.recipes = argv[++i].split(",").filter(Boolean);
    else if (arg === "--max-ticks") options.maxTicks = Number(argv[++i]);
    else if (arg === "--out-dir") options.outDir = resolve(argv[++i]);
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const outDir = options.outDir ?? join(ROOT, "artifacts/play-sim", `recipe-ladder-${runId}`);
    const { summary } = await runRecipeLadder({ ...options, outDir, log: (line) => console.log(line) });
    console.log(`${summary.flags.length} flag(s). Wrote ${outDir}`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
