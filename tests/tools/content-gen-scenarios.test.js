const assert = require("node:assert/strict");

const {
  UNCONSTRAINED_SENTINEL,
  scenarioBudgetMode,
} = require("../../tools/remote-ollama-control/scripts/lib/ak-scenarios");

test("an explicit budget below the sentinel is a constrained budget test", () => {
  assert.deepEqual(scenarioBudgetMode({ budgetTokens: 250 }), {
    budgetMode: "constrained",
    budget: 250,
  });
});

test("the non-binding ceiling generate-baselines writes reads as unconstrained", () => {
  assert.deepEqual(scenarioBudgetMode({ budgetTokens: UNCONSTRAINED_SENTINEL }), {
    budgetMode: "unconstrained",
    budget: null,
  });
});

test("a budget one token below the sentinel is still constrained", () => {
  assert.deepEqual(scenarioBudgetMode({ budgetTokens: UNCONSTRAINED_SENTINEL - 1 }), {
    budgetMode: "constrained",
    budget: UNCONSTRAINED_SENTINEL - 1,
  });
});

test("an absent budget is unconstrained", () => {
  assert.deepEqual(scenarioBudgetMode({}), { budgetMode: "unconstrained", budget: null });
});

// A note whose MCP payload is missing or unparseable arrives here as null. It
// classifies as unconstrained, which is the safe direction: the run spends what
// the scenario needs rather than being capped by a budget nobody declared.
test("a missing payload is unconstrained rather than throwing", () => {
  assert.deepEqual(scenarioBudgetMode(null), { budgetMode: "unconstrained", budget: null });
  assert.deepEqual(scenarioBudgetMode(undefined), { budgetMode: "unconstrained", budget: null });
});

// Guards the boundary the scorer depends on: ak-compare only compares spend
// against the reference for constrained scenarios, so a non-integer budget must
// never be reported as constrained with a bogus cap.
test("non-integer budgets are unconstrained", () => {
  for (const budgetTokens of [null, "1500", 1500.5, Number.NaN]) {
    assert.deepEqual(
      scenarioBudgetMode({ budgetTokens }),
      { budgetMode: "unconstrained", budget: null },
      `expected ${String(budgetTokens)} to classify as unconstrained`,
    );
  }
});
