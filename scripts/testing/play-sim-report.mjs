#!/usr/bin/env node
/**
 * Play-sim M2 (#613): turn a play-sim run directory (M1, scripts/testing/play-sim.mjs) into anomaly
 * cards and a baseline-vs-treatment cohort summary. Reads the per-run JSON only; plays nothing and
 * changes no price. Cards and the cohort go under <in>/cards and <in>/cohort.json (gitignored with
 * artifacts/); an advisor (M5) reads these, never the raw runs.
 *
 *   node scripts/testing/play-sim-report.mjs --in artifacts/play-sim/<run-id> [--json]
 *
 * A card is written for each run that is not a plain exit with no rule hits.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Treatment ticks-to-exit at least this much above baseline is flagged slower. */
export const SLOWER_RATIO = 1.2;

export function loadRuns(dir) {
  return readdirSync(dir).filter((file) => file.endsWith(".json") && file !== "summary.json" && file !== "cohort.json")
    .map((file) => ({ file, ...JSON.parse(readFileSync(join(dir, file), "utf8")) }))
    .filter((run) => run.scenario && run.arm);
}

/** Anomalies a run shows: any rule hit, or an outcome other than leaving the level. */
export function anomaliesOf(run) {
  const reasons = run.ruleHits.map((hit) => hit.rule);
  if (run.outcome !== "exited") reasons.push(`outcome_${run.outcome}`);
  return [...new Set(reasons)];
}

export function buildCard(run) {
  return {
    schema: "agon/PlaySimCard",
    version: 1,
    scenario: run.scenario,
    seed: run.seed,
    arm: run.arm,
    strategy: run.strategy,
    outcome: run.outcome,
    ticks: run.ticks,
    anomalies: anomaliesOf(run),
    ruleHits: run.ruleHits,
    metrics: { finalVitals: run.finalVitals ?? null, minVitals: run.minVitals ?? {}, delverPool: run.delverPool ?? null, budgetTokens: run.budgetTokens },
    build: run.build?.fingerprint ?? null,
  };
}

const rate = (count, total) => (total === 0 ? null : Math.round((count / total) * 1000) / 1000);
const mean = (values) => (values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10);

function armSummary(runs) {
  const total = runs.length;
  const exited = runs.filter((run) => run.outcome === "exited");
  const ruleCounts = {};
  for (const run of runs) for (const hit of run.ruleHits) ruleCounts[hit.rule] = (ruleCounts[hit.rule] ?? 0) + 1;
  return {
    runs: total,
    exitRate: rate(exited.length, total),
    defeatRate: rate(runs.filter((run) => run.outcome === "defeated").length, total),
    timeoutRate: rate(runs.filter((run) => run.outcome === "timeout").length, total),
    ruleHitRate: rate(runs.filter((run) => run.ruleHits.length > 0).length, total),
    ruleCounts,
    meanTicksToExit: mean(exited.map((run) => run.ticks)),
    meanDelverCap: mean(runs.map((run) => run.delverPool?.capTokens).filter(Number.isFinite)),
  };
}

/** Per arm rates, and per scenario+seed the pairs whose outcome or speed changed. */
export function buildCohort(runs) {
  const arms = {};
  for (const arm of [...new Set(runs.map((run) => run.arm))]) arms[arm] = armSummary(runs.filter((run) => run.arm === arm));
  const flags = [];
  const key = (run) => `${run.scenario}#${run.seed}`;
  for (const base of runs.filter((run) => run.arm === "baseline")) {
    const treat = runs.find((run) => run.arm === "treatment" && key(run) === key(base));
    if (!treat) continue;
    if (treat.outcome !== base.outcome) {
      flags.push({ flag: "outcome_changed", scenario: base.scenario, seed: base.seed, baseline: base.outcome, treatment: treat.outcome });
    } else if (base.outcome === "exited" && treat.ticks >= base.ticks * SLOWER_RATIO) {
      flags.push({ flag: "treatment_slower", scenario: base.scenario, seed: base.seed, baselineTicks: base.ticks, treatmentTicks: treat.ticks });
    }
    const newHits = treat.ruleHits.map((hit) => hit.rule).filter((rule) => !base.ruleHits.some((hit) => hit.rule === rule));
    if (newHits.length) flags.push({ flag: "treatment_new_rule_hits", scenario: base.scenario, seed: base.seed, rules: [...new Set(newHits)] });
  }
  if (arms.baseline && arms.treatment) {
    const dExit = (arms.treatment.exitRate ?? 0) - (arms.baseline.exitRate ?? 0);
    if (dExit !== 0) flags.push({ flag: "exit_rate_delta", delta: Math.round(dExit * 1000) / 1000 });
  }
  return { schema: "agon/PlaySimCohort", version: 1, arms, flags };
}

/** Write cards/ and cohort.json under `dir`; returns { cards, cohort }. */
export function report(dir) {
  const runs = loadRuns(dir);
  const cards = runs.filter((run) => anomaliesOf(run).length > 0).map((run) => ({ file: `${run.scenario}-s${run.seed}-${run.arm}.json`, card: buildCard(run) }));
  const cohort = buildCohort(runs);
  mkdirSync(join(dir, "cards"), { recursive: true });
  for (const { file, card } of cards) writeFileSync(join(dir, "cards", file), `${JSON.stringify(card, null, 2)}\n`);
  writeFileSync(join(dir, "cohort.json"), `${JSON.stringify(cohort, null, 2)}\n`);
  return { cards: cards.map((entry) => entry.card), cohort };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--in");
  if (at < 0 || !process.argv[at + 1]) {
    console.error("usage: play-sim-report.mjs --in <play-sim run dir> [--json]");
    process.exit(2);
  }
  const { cards, cohort } = report(resolve(process.argv[at + 1]));
  if (process.argv.includes("--json")) console.log(JSON.stringify(cohort, null, 2));
  else {
    for (const [arm, summary] of Object.entries(cohort.arms)) {
      console.log(`${arm}: ${summary.runs} runs, exit ${summary.exitRate}, defeat ${summary.defeatRate}, timeout ${summary.timeoutRate}, rule-hit ${summary.ruleHitRate}, mean ticks to exit ${summary.meanTicksToExit}`);
    }
    for (const flag of cohort.flags) console.log(`flag: ${JSON.stringify(flag)}`);
    console.log(`${cards.length} anomaly card(s) written to ${process.argv[at + 1]}/cards`);
  }
}
