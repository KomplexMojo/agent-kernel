const assert = require("node:assert/strict");


test("UI budgetSplitPercent handoff: poolWeights pass through summary → BuildSpec → allocation", async () => {
  const { buildBuildSpecFromSummary } = await import("../../packages/runtime/src/personas/director/buildspec-assembler.js");
const { computeBudgetPools } = await import("../../packages/runtime/src/personas/director/budget-allocation.js");

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
const buildResult = buildBuildSpecFromSummary({ summary, runId: "test_handoff" });
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
  const { buildBuildSpecFromSummary } = await import("../../packages/runtime/src/personas/director/buildspec-assembler.js");
const { computeBudgetPools } = await import("../../packages/runtime/src/personas/director/budget-allocation.js");

const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 2500,
  rooms: [],
  actors: [],
  missing: []
};

const buildResult = buildBuildSpecFromSummary({ summary, runId: "test_default" });
assert.ok(buildResult.ok);

// When poolWeights not provided, should use defaults (44/20/16/12/8)
const allocation = computeBudgetPools({
  budgetTokens: buildResult.spec.intent.hints.budgetTokens,
  poolWeights: buildResult.spec.intent.hints.poolWeights
});
assert.ok(allocation.ok);

const poolMap = new Map(allocation.pools.map(p => [p.id, p.tokens]));
assert.equal(poolMap.get("rooms"), 1100, "44% of 2500 = 1100");
assert.equal(poolMap.get("delver"), 500, "20% of 2500 = 500");
assert.equal(poolMap.get("wardens"), 400, "16% of 2500 = 400");
assert.equal(poolMap.get("hazards"), 300, "12% of 2500 = 300");
assert.equal(poolMap.get("resources"), 200, "8% of 2500 = 200");
});
