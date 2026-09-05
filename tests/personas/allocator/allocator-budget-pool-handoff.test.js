const assert = require("node:assert/strict");


test("UI budgetSplitPercent handoff: poolWeights pass through summary → BuildSpec → allocation", async () => {
  const { buildBuildSpecFromSummary } = await import("../../../packages/runtime/src/personas/director/buildspec-assembler.js");
const { computeBudgetPools } = await import("../../../packages/runtime/src/personas/allocator/budget-allocation.js");

// Simulate UI passing custom budget and split percentages
const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 800,
  poolWeights: [
    { id: "rooms", weight: 0.60 },
    { id: "delver", weight: 0.15 },
    { id: "wardens", weight: 0.25 }
  ],
  rooms: [
    {
      motivation: "stationary",
      affinity: "fire",
      count: 1,
      tokenHint: 200,
      affinities: [{ kind: "fire", expression: "push", stacks: 1 }]
    }
  ],
  actors: [],
  missing: []
};

// Step 1: Build BuildSpec from summary
const buildResult = buildBuildSpecFromSummary({ summary, runId: "test_handoff", clock: () => "2026-08-06T00:00:00.000Z" });
assert.ok(buildResult.ok, "BuildSpec assembly should succeed");
assert.ok(buildResult.spec, "BuildSpec should be created");

// Step 2: Verify intent.hints preserves budgetTokens and poolWeights
assert.equal(buildResult.spec.intent.hints.budgetTokens, 800);
assert.ok(Array.isArray(buildResult.spec.intent.hints.poolWeights));
assert.equal(buildResult.spec.intent.hints.poolWeights.length, 3);

// Step 3: Verify budget allocation uses the custom poolWeights
const allocation = computeBudgetPools({
  budgetTokens: buildResult.spec.intent.hints.budgetTokens,
  poolWeights: buildResult.spec.intent.hints.poolWeights
});
assert.ok(allocation.ok);

const poolMap = new Map(allocation.pools.map(p => [p.id, p.tokens]));
assert.equal(poolMap.get("rooms"), 480, "60% of 800 = 480");
assert.equal(poolMap.get("delver"), 120, "15% of 800 = 120");
assert.equal(poolMap.get("wardens"), 200, "25% of 800 = 200");
assert.equal(poolMap.get("hazards"), 0, "not specified → 0");
assert.equal(poolMap.get("resources"), 0, "not specified → 0");
});

test("default allocation when poolWeights not provided", async () => {
  const { buildBuildSpecFromSummary } = await import("../../../packages/runtime/src/personas/director/buildspec-assembler.js");
const { computeBudgetPools } = await import("../../../packages/runtime/src/personas/allocator/budget-allocation.js");

const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 2500,
  rooms: [],
  actors: [],
  missing: []
};

const buildResult = buildBuildSpecFromSummary({ summary, runId: "test_default", clock: () => "2026-08-06T00:00:00.000Z" });
assert.ok(buildResult.ok);

// When poolWeights not provided, should use defaults (44/20/16/12/8)
const allocation = computeBudgetPools({
  budgetTokens: buildResult.spec.intent.hints.budgetTokens,
  poolWeights: buildResult.spec.intent.hints.poolWeights
});
assert.ok(allocation.ok);

const poolMap = new Map(allocation.pools.map(p => [p.id, p.tokens]));
assert.equal(poolMap.get("rooms"), 725, "29% of 2500 = 725");
assert.equal(poolMap.get("delver"), 625, "25% of 2500 = 625");
assert.equal(poolMap.get("wardens"), 575, "23% of 2500 = 575");
assert.equal(poolMap.get("hazards"), 375, "15% of 2500 = 375");
assert.equal(poolMap.get("resources"), 200, "8% of 2500 = 200");
});
