import { describe, expect, it } from "vitest";
import { compareRank, runSolverLedger } from "../helpers/solver-ledger.mjs";
import { budgetFitDomain, objectPlacementDomain } from "../helpers/solver-ledger-domains.mjs";
import { LEDGER_DOMAINS } from "../../scripts/testing/logic-value-ledger.mjs";

// The adoption rule for every domain measured here, stated before any run (#298): the
// solver is never worse than the fallback, and better on at least 5% of decided cases.
const ADOPTION_RULE = Object.freeze({ minSolverBetterFraction: 0.05, maxFallbackBetter: 0 });

function synthetic(pairs, { oracle = null } = {}) {
  return {
    domain: "synthetic",
    cases: pairs.map(([fallback, solver], index) => ({ index, fallback, solver })),
    fallback: async (problem) => problem.fallback,
    solver: async (problem) => problem.solver,
    rank: (answer) => answer,
    oracle,
    gap: (solverRank, fallbackRank) => (solverRank?.[0] ?? 0) - (fallbackRank?.[0] ?? 0),
  };
}

describe("solver ledger harness", () => {
  it("refuses to run without a verdict rule stated up front", async () => {
    await expect(runSolverLedger(synthetic([[[1], [2]]]))).rejects.toThrow(/verdictRule/);
  });

  it("compares ranks lexicographically and treats a refusal as worst", () => {
    expect(compareRank([2, 0], [1, 9])).toBe(1);
    expect(compareRank([1], [1])).toBe(0);
    expect(compareRank(null, [0])).toBe(-1);
    expect(compareRank([0], null)).toBe(1);
  });

  it("adopts a solver that wins by the margin and is never worse", async () => {
    const result = await runSolverLedger({
      ...synthetic([[[1], [3]], [null, [1]], [[2], [2]], [[2], [2]]]),
      verdictRule: ADOPTION_RULE,
    });
    expect(result.counters).toMatchObject({ points: 4, solverBetter: 2, fallbackBetter: 0, agree: 2, refusalsRecovered: 1 });
    expect(result.derived.divergenceRate).toBe(0.5);
    expect(result.derived.maxGap).toBe(2);
    expect(result.verdict).toBe("adopt");
  });

  it("rejects a solver that is ever worse, or wins by less than the margin", async () => {
    const worse = await runSolverLedger({ ...synthetic([[[3], [1]], [[1], [3]]]), verdictRule: ADOPTION_RULE });
    expect(worse.verdict).toBe("reject");
    expect(worse.reasons.join(" ")).toMatch(/fallback was better 1 times/);

    const marginal = await runSolverLedger({
      ...synthetic([...Array.from({ length: 99 }, () => [[1], [1]]), [[1], [2]]]),
      verdictRule: ADOPTION_RULE,
    });
    expect(marginal.verdict).toBe("reject");
    expect(marginal.reasons.join(" ")).toMatch(/solver was better on 1\.0%/);
  });

  it("rejects when the solver beats the exhaustive oracle, which means a broken encoding", async () => {
    const result = await runSolverLedger({
      ...synthetic([[[1], [5]]], { oracle: () => [2] }),
      verdictRule: ADOPTION_RULE,
    });
    expect(result.counters.solverBeatsOracle).toBe(1);
    expect(result.verdict).toBe("reject");
  });
});

// A slice of each adopted domain's gate bounds, re-measured through the shared harness on
// every run. Full gate numbers are in the #298 commit message.
describe("adopted domains through the shared ledger", () => {
  it("allocator_budget_fit keeps its adoption", async () => {
    const result = await runSolverLedger({
      ...budgetFitDomain(LEDGER_DOMAINS.allocator_budget_fit.bounds.gate, { limit: 150 }),
      verdictRule: ADOPTION_RULE,
    });
    expect(result.counters.points).toBe(150);
    expect(result.counters.solverBeatsOracle).toBe(0);
    expect(result.derived.solverOptimalFraction).toBe(1);
    expect(result.verdict, result.reasons.join("; ")).toBe("adopt");
  }, 60_000);

  it("configurator_satisfiability keeps its adoption", async () => {
    const result = await runSolverLedger({
      ...objectPlacementDomain(LEDGER_DOMAINS.configurator_satisfiability.bounds.gate, { limit: 80 }),
      verdictRule: ADOPTION_RULE,
    });
    expect(result.counters.points).toBe(80);
    expect(result.counters.solverBeatsOracle).toBe(0);
    expect(result.derived.solverOptimalFraction).toBe(1);
    expect(result.verdict, result.reasons.join("; ")).toBe("adopt");
  }, 60_000);
});
