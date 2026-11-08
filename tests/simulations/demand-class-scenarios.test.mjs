// Playability P5 (#623): the sweep catalogue holds scenarios that reward different responses
// (kite, optional risk, recovery). Balance numbers are metrics in `pnpm run sim:sweep`, not failures
// here; this only proves they stay in the catalogue and still build and run through `agon create`/`agon run`.
import { expect, test } from "vitest";
import { loadScenarios, runScenario } from "../../scripts/testing/simulation-lib.mjs";

const DEMAND = { "sweep-demand-kite": /KITE/, "sweep-demand-optional-risk": /OPTIONAL RISK/, "sweep-demand-recovery": /RECOVERY BEAT/ };
const demand = loadScenarios("sweep").filter((scenario) => scenario.id in DEMAND);

test("the sweep catalogue names each demand class and keeps the core set small", () => {
  expect(demand.map((scenario) => scenario.id).sort()).toEqual(Object.keys(DEMAND).sort());
  for (const scenario of demand) expect(scenario.note).toMatch(DEMAND[scenario.id]);
  expect(loadScenarios("core").some((scenario) => scenario.id in DEMAND)).toBe(false);
});

for (const scenario of demand) {
  test(`${scenario.id} builds through agon create and runs`, async () => {
    const result = await runScenario(scenario);
    expect(result.createError).toBeUndefined();
    expect(result.runError).toBeUndefined();
    expect(result.ticks).toBeGreaterThan(0);
  }, 120000);
}

// ## TODO: Test Permutations
// - the same scenarios under other seeds; each demand class's metric expectation once P3's dominance boards exist
