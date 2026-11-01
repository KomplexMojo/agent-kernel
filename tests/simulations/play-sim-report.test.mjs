// Play-sim M2 (#613): anomaly cards and the baseline-vs-treatment cohort, from committed run fixtures.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildCard, buildCohort, loadRuns, report } from "../../scripts/testing/play-sim-report.mjs";

const FIXTURES = join(import.meta.dirname, "../fixtures/play-sim");

test("a run with a rule hit or a non-exit outcome gets a card; a clean exit does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "play-sim-report-"));
  try {
    cpSync(FIXTURES, dir, { recursive: true });
    const { cards } = report(dir);
    expect(readdirSync(join(dir, "cards")).sort()).toEqual(["traits-s1-baseline.json", "traits-s1-treatment.json"]);
    const card = JSON.parse(readFileSync(join(dir, "cards/traits-s1-treatment.json"), "utf8"));
    expect(card).toMatchObject({ scenario: "traits", seed: 1, arm: "treatment", outcome: "defeated", ticks: 1 });
    expect(card.anomalies).toEqual(["adjacent_objects", "tick_one_defeat", "outcome_defeated"]);
    expect(card.ruleHits.map((hit) => hit.rule)).toContain("tick_one_defeat");
    expect(card.build).toMatch(/^hero-1\[/);
    expect(cards).toHaveLength(2);
    expect(existsSync(join(dir, "cohort.json"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cohort compares arms and flags pairs that changed", () => {
  const cohort = buildCohort(loadRuns(FIXTURES));
  expect(cohort.arms.baseline).toMatchObject({ runs: 2, exitRate: 1, meanTicksToExit: 22.5 });
  expect(cohort.arms.treatment).toMatchObject({ runs: 2, exitRate: 0.5, defeatRate: 0.5, meanTicksToExit: 30 });
  expect(cohort.arms.treatment.ruleCounts.tick_one_defeat).toBe(1);
  const flags = cohort.flags.map((flag) => flag.flag);
  expect(flags).toContain("treatment_slower");
  expect(cohort.flags.find((flag) => flag.flag === "outcome_changed")).toMatchObject({ scenario: "traits", baseline: "exited", treatment: "defeated" });
  expect(cohort.flags.find((flag) => flag.flag === "treatment_new_rule_hits").rules).toEqual(["tick_one_defeat"]);
  expect(cohort.flags.find((flag) => flag.flag === "exit_rate_delta").delta).toBe(-0.5);
});

test("buildCard keeps the run's key metrics", () => {
  const [run] = loadRuns(FIXTURES);
  expect(buildCard(run).metrics.minVitals).toEqual({ health: 12 });
});

// ## TODO: Test Permutations
// - a run dir with only one arm; no runs at all; a create_failed record; the CLI entry with --json
