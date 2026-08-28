const assert = require("node:assert/strict");
const { scoreRun } = require("../../tools/remote-ollama-control/scripts/lib/ak-compare");

// A scenario that is SUPPOSED to be denied must be scored like any other.
//
// scoreRun used to return early when the build did not succeed, so the six catalog scenarios
// expecting `budget_denied` could never earn more than the 20-point tool-call gate -- and were
// scored BLIND: a model that authored exactly the right spec and one that authored nonsense both
// scored 20, provided both were denied. The verdict rate cannot separate them either, because it
// only compares outcome labels. Correct authoring was unrewardable on 6% of the catalog.

const denialScenario = {
  index: 93, budgetMode: "constrained", budget: 85, expectedOutcome: "budget_denied",
  reference: { entityCounts: { warden: 1 }, affinitiesByType: { warden: ["dark"] }, totalSpend: 86 },
};
const denied = (toolArgs, over = 1) => ({
  toolCallProduced: true, toolArgs, outDir: null,
  execResult: { succeeded: false, stdout: "", stderr: `Budget receipt denied: status=denied; remaining=-${over};` },
});

test("a correctly denied build is scored on what it authored, not capped at the gate", () => {
  const right = scoreRun(denied({ warden: [{ count: 1, affinity: "dark", motivation: "defending" }] }),
    denialScenario, undefined, undefined, { outcome: "budget_denied" });
  assert.ok(right.points > 20,
    `a correct denial scored ${right.points}; it used to be capped at the 20-point tool-call gate`);
  assert.equal(right.breakdown.outcomeMatched, 10, "matching the expected outcome must be credited");
});

test("a wrong spec that is also denied scores far below a right one", () => {
  const opts = { outcome: "budget_denied" };
  const right = scoreRun(denied({ warden: [{ count: 1, affinity: "dark", motivation: "defending" }] }),
    denialScenario, undefined, undefined, opts).points;
  const wrong = scoreRun(denied({
    warden: [{ count: 9, affinity: "fire", motivation: "attacking" }],
    delver: [{ count: 5, affinity: "life", motivation: "patrolling" }],
  }), denialScenario, undefined, undefined, opts).points;
  assert.ok(right > wrong + 20,
    `right=${right} wrong=${wrong} — the two must be distinguishable, which is the whole defect: `
    + "under the old rules both scored exactly 20 and nothing could tell them apart");
});

test("succeeding when denial was expected is not rewarded for succeeding", () => {
  const succeeded = {
    toolCallProduced: true, toolArgs: { warden: [{ count: 1, affinity: "dark" }] }, outDir: null,
    execResult: { succeeded: true, stdout: "", stderr: "" },
  };
  const r = scoreRun(succeeded, denialScenario, undefined, undefined, { outcome: "success" });
  assert.equal(r.breakdown.outcomeMatched, 0,
    "the old execSucceeded gate paid 10 points for succeeding when the scenario expected a denial");
});

// The overshoot is real information: denied by 1 token shows a grasp of the economy that denied by
// 400 does not, and both used to be discarded.
test("how far over the budget a denial went changes the score", () => {
  const args = { warden: [{ count: 1, affinity: "dark", motivation: "defending" }] };
  const near = scoreRun(denied(args, 1), denialScenario, undefined, undefined, { outcome: "budget_denied" });
  const far = scoreRun(denied(args, 400), denialScenario, undefined, undefined, { outcome: "budget_denied" });
  assert.ok(near.breakdown.budgetDelta > far.breakdown.budgetDelta,
    `near=${near.breakdown.budgetDelta} far=${far.breakdown.budgetDelta}`);
  assert.equal(far.breakdown.budgetDelta, 0, "wildly over the budget earns nothing for proximity");
});

// The change must be invisible to scenarios that succeed: those read the BUILT spec, and the
// tool-args fallback exists only for builds that never produced one.
test("a successful build still scores from the built spec, not the tool call", () => {
  const successScenario = { ...denialScenario, expectedOutcome: "success" };
  const r = scoreRun({
    toolCallProduced: true, toolArgs: { warden: [{ count: 99, affinity: "fire" }] }, outDir: null,
    execResult: { succeeded: true, stdout: "", stderr: "" },
  }, successScenario, undefined, undefined, { outcome: "success" });
  assert.equal(r.breakdown.outcomeMatched, 10);
  assert.ok(Number.isInteger(r.points) && r.points <= 100);
});
