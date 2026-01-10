const test = require("node:test");
const assert = require("node:assert/strict");

test("enforceBudget trims to cap deterministically", async () => {
  const { enforceBudget } = await import("../../packages/runtime/src/personas/director/budget-enforcer.js");
  const selections = [
    { applied: { id: "hi_cost", cost: 200 }, requested: { count: 2 } },
    { applied: { id: "mid_cost", cost: 120 }, requested: { count: 2 } },
    { applied: { id: "low_cost", cost: 80 }, requested: { count: 3 } },
  ];

  const result = enforceBudget({ selections, budgetTokens: 400 });

  assert.equal(result.totalRequested, 2 * 200 + 2 * 120 + 3 * 80);
  assert.equal(result.totalApplied <= 400, true);
  assert.equal(result.actions.length > 0, true);
  // Highest cost trimmed first
  const hi = result.selections.find((s) => s.applied.id === "hi_cost");
  assert.equal(hi.approvedCount <= 2, true);
  const mid = result.selections.find((s) => s.applied.id === "mid_cost");
  const low = result.selections.find((s) => s.applied.id === "low_cost");
  assert.equal(mid.unitCost >= low.unitCost, true);
  assert.ok(result.actions.some((a) => a.id && a.action === "downTierOrDrop"));
});

test("enforceBudget passes through when no cap", async () => {
  const { enforceBudget } = await import("../../packages/runtime/src/personas/director/budget-enforcer.js");
  const selections = [{ applied: { id: "item", cost: 100 }, requested: { count: 1 } }];
  const result = enforceBudget({ selections });
  assert.equal(result.totalApproved, 100);
  assert.equal(result.actions.length, 0);
});
