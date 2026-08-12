const assert = require("node:assert/strict");


test("default pool weights: 44% rooms, async 20% delver, 16% wardens, 12% hazards, 8% resources (design §2.2)", async () => {
  const { computeBudgetPools, REFERENCE_BUDGET_TOKENS } = await import("../../packages/runtime/src/personas/director/budget-allocation.js");

  const result = computeBudgetPools({ budgetTokens: 2500 });
  assert.ok(result.ok);

  const poolMap = new Map(result.pools.map(p => [p.id, p.tokens]));
  assert.equal(poolMap.get("rooms"), 1100);
  assert.equal(poolMap.get("delver"), 500);
  assert.equal(poolMap.get("wardens"), 400);
  assert.equal(poolMap.get("hazards"), 300);
  assert.equal(poolMap.get("resources"), 200);
});

test("reference budget constant is 2500 (design §2.1)", async () => {
  const { REFERENCE_BUDGET_TOKENS } = await import("../../packages/runtime/src/personas/director/budget-allocation.js");

  assert.equal(REFERENCE_BUDGET_TOKENS, 2500);
});

test("custom pool weights override defaults", async () => {
  const { computeBudgetPools } = await import("../../packages/runtime/src/personas/director/budget-allocation.js");

  const result = computeBudgetPools({
    budgetTokens: 800,
    poolWeights: [
      { id: "rooms", weight: 0.60 },
      { id: "delver", weight: 0.15 },
      { id: "wardens", weight: 0.25 }
    ]
  });
  assert.ok(result.ok);

  const poolMap = new Map(result.pools.map(p => [p.id, p.tokens]));
  assert.equal(poolMap.get("rooms"), 480);
  assert.equal(poolMap.get("delver"), 120);
  assert.equal(poolMap.get("wardens"), 200);
  assert.equal(poolMap.get("hazards"), 0);
  assert.equal(poolMap.get("resources"), 0);
});

test("explicit resource-only pool weights are honored for first-order resource authoring", async () => {
  const { computeBudgetPools } = await import("../../packages/runtime/src/personas/director/budget-allocation.js");

  const result = computeBudgetPools({
    budgetTokens: 200,
    poolWeights: [
      { id: "resources", weight: 1 },
    ],
  });
  assert.ok(result.ok);

  const poolMap = new Map(result.pools.map(p => [p.id, p.tokens]));
  assert.equal(poolMap.get("resources"), 200);
  assert.equal(poolMap.get("rooms"), 0);
  assert.equal(poolMap.get("hazards"), 0);
  assert.equal(poolMap.get("wardens"), 0);
  assert.equal(poolMap.get("delver"), 0);
});
