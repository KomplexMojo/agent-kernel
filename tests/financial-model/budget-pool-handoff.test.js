const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const buildspecAssemblerUrl = moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js");
const budgetAllocUrl = moduleUrl("packages/runtime/src/personas/director/budget-allocation.js");

test("UI budgetSplitPercent handoff: poolWeights pass through summary → BuildSpec → allocation", () => {
  runEsm(`
import assert from "node:assert/strict";
import { buildBuildSpecFromSummary } from ${JSON.stringify(buildspecAssemblerUrl)};
import { computeBudgetPools } from ${JSON.stringify(budgetAllocUrl)};

// Simulate UI passing custom budget and split percentages
const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 800,
  poolWeights: [
    { id: "layout", weight: 0.60 },
    { id: "player", weight: 0.15 },
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
assert.equal(poolMap.get("layout"), 480, "60% of 800 = 480");
assert.equal(poolMap.get("player"), 120, "15% of 800 = 120");
assert.equal(poolMap.get("wardens"), 200, "25% of 800 = 200");
`);
});

test("default allocation when poolWeights not provided", () => {
  runEsm(`
import assert from "node:assert/strict";
import { buildBuildSpecFromSummary } from ${JSON.stringify(buildspecAssemblerUrl)};
import { computeBudgetPools } from ${JSON.stringify(budgetAllocUrl)};

const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 1000,
  rooms: [],
  actors: [],
  missing: []
};

const buildResult = buildBuildSpecFromSummary({ summary, runId: "test_default" });
assert.ok(buildResult.ok);

// When poolWeights not provided, should use defaults (55/20/25)
const allocation = computeBudgetPools({
  budgetTokens: buildResult.spec.intent.hints.budgetTokens,
  poolWeights: buildResult.spec.intent.hints.poolWeights
});
assert.ok(allocation.ok);

const poolMap = new Map(allocation.pools.map(p => [p.id, p.tokens]));
assert.equal(poolMap.get("layout"), 550, "55% of 1000 = 550");
assert.equal(poolMap.get("player"), 200, "20% of 1000 = 200");
assert.equal(poolMap.get("wardens"), 250, "25% of 1000 = 250");
`);
});
