// Simulation tests: every core scenario is built through `ak create`, run headless through
// `ak run`, and checked against the rules every level must satisfy (scripts/testing/simulation-lib.mjs).
// A scenario lists the violations still open as `knownIssues`, each tied to an issue. The test fails
// on any violation not listed, and on a listed one that no longer happens, so fixing an issue means
// deleting its entry here. Metrics are not checked; `pnpm run sim:sweep` reports them.
import {
  RULES,
  checkRules,
  compareWithKnown,
  loadScenarios,
  runScenarios,
} from "../../scripts/testing/simulation-lib.mjs";

const scenarios = loadScenarios("core");
let results;

beforeAll(async () => {
  results = await runScenarios(scenarios, { concurrency: 4 });
}, 180_000);

test("the core catalogue is well formed", () => {
  const ids = scenarios.map((scenario) => scenario.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const scenario of scenarios) {
    expect(Array.isArray(scenario.args) && scenario.args.length > 0).toBe(true);
    for (const entry of scenario.knownIssues ?? []) {
      expect(Object.keys(RULES)).toContain(entry.rule);
      expect(entry.issue).toMatch(/^#\d+$/);
    }
  }
});

describe.each(scenarios.map((scenario, index) => [scenario.id, index]))("simulation %s", (id, index) => {
  test("breaks no rule beyond its known issues", () => {
    const scenario = scenarios[index];
    const { unexpected } = compareWithKnown(scenario, checkRules(scenario, results[index]));
    expect(unexpected.map((violation) => `${violation.rule}${violation.actor ? ` ${violation.actor}` : ""}: `
      + `${RULES[violation.rule]}${violation.detail ? ` (${violation.detail})` : ""}`)).toEqual([]);
  });

  test("every known issue it lists still happens (delete the entry once fixed)", () => {
    const scenario = scenarios[index];
    const { fixed } = compareWithKnown(scenario, checkRules(scenario, results[index]));
    expect(fixed.map((entry) => `${entry.rule} ${entry.issue}`)).toEqual([]);
  });
});
