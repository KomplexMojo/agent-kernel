// Play-sim M1 (#612): the harness writes one metrics + rule-hit JSON per scenario, seed and arm.
// The shape is what the cohort report (M2) reads; play itself is the runtime's, covered elsewhere.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { armBudgets, runPlaySim, strategyFor, TREATMENT_SHARE } from "../../scripts/testing/play-sim.mjs";

test("the treatment arm is floor(90%) of the scenario budget; the flags select arms", () => {
  const scenario = { budgetTokens: 4000 };
  expect(armBudgets(scenario)).toEqual([{ arm: "baseline", budgetTokens: 4000 }, { arm: "treatment", budgetTokens: 3600 }]);
  expect(armBudgets({ budgetTokens: 6500 }, { baseline: false }).map((entry) => entry.budgetTokens)).toEqual([Math.floor(TREATMENT_SHARE * 6500)]);
  expect(armBudgets(scenario, { treatment: false }).map((entry) => entry.arm)).toEqual(["baseline"]);
});

test("strategies are orders agon_play_order takes: reach the exit, fight adds a cast tactic", () => {
  expect(strategyFor("dash")).toEqual({ goals: [{ kind: "reach", place: "exit" }] });
  expect(strategyFor("fight").tactics[0].do.params.targetId).toBe("nearest_hostile");
  expect(() => strategyFor("nope")).toThrow(/unknown strategy/);
});

test("one scenario, one seed, two arms writes a record per arm and a summary", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "play-sim-test-"));
  try {
    const { runs } = await runPlaySim({ scenarios: ["first-look"], seeds: [0], outDir });
    expect(readdirSync(outDir).sort()).toEqual(["first-look-s0-baseline.json", "first-look-s0-treatment.json", "summary.json"]);
    expect(runs.map((run) => run.arm)).toEqual(["baseline", "treatment"]);
    for (const arm of ["baseline", "treatment"]) {
      const record = JSON.parse(readFileSync(join(outDir, `first-look-s0-${arm}.json`), "utf8"));
      expect(record).toMatchObject({ scenario: "first-look", seed: 0, arm, strategy: "dash" });
      expect(["exited", "defeated", "timeout", "create_failed", "order_refused"]).toContain(record.outcome);
      expect(typeof record.ticks).toBe("number");
      expect(Array.isArray(record.ruleHits)).toBe(true);
      expect(record.build.fingerprint).toMatch(/hero-1\[/);
      expect(record.delverPool.capTokens).toBeGreaterThan(0);
    }
    const [base, treat] = runs;
    expect(treat.budgetTokens).toBe(Math.floor(TREATMENT_SHARE * base.budgetTokens));
    expect(treat.delverPool.capTokens).toBeLessThan(base.delverPool.capTokens);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);

// ## TODO: Test Permutations
// - --baseline-only / --treatment-only through the CLI entry; unknown scenario names; a scenario the 90% arm cannot afford (create_failed record)
