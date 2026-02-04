const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFixture } = require("../helpers/fixtures");

const modulePath = moduleUrl("packages/runtime/src/personas/director/budget-allocation.js");
const budgetFixture = readFixture("budget-artifact-v1-basic.json");
const priceListFixture = readFixture("price-list-artifact-v1-basic.json");

const script = `
import assert from "node:assert/strict";
import { buildBudgetAllocation } from ${JSON.stringify(modulePath)};

const budget = ${JSON.stringify(budgetFixture)};
const priceList = ${JSON.stringify(priceListFixture)};
const meta = {
  id: "allocation_basic",
  runId: "run_fixture",
  createdAt: "2025-01-01T00:00:00.000Z",
  producedBy: "director",
};

const result = buildBudgetAllocation({
  budget,
  priceList,
  meta,
  policy: { reserveTokens: 100, maxActorSpend: 300 },
});

assert.equal(result.ok, true);
const allocation = result.allocation;
assert.equal(allocation.schema, "agent-kernel/BudgetAllocationArtifact");
assert.equal(allocation.schemaVersion, 1);
assert.deepEqual(allocation.meta, meta);
assert.equal(allocation.budgetRef.schema, "agent-kernel/BudgetArtifact");
assert.equal(allocation.priceListRef.schema, "agent-kernel/PriceList");
assert.deepEqual(allocation.policy, { reserveTokens: 100, maxActorSpend: 300 });

const poolsById = Object.fromEntries(allocation.pools.map((pool) => [pool.id, pool.tokens]));
assert.equal(poolsById.player, 180);
assert.equal(poolsById.layout, 360);
assert.equal(poolsById.defenders, 360);
assert.equal(poolsById.loot, 0);

const custom = buildBudgetAllocation({
  budget,
  priceList,
  meta,
  policy: { reserveTokens: 50 },
  poolWeights: [
    { id: "player", weight: 0.1 },
    { id: "layout", weight: 0.2 },
    { id: "defenders", weight: 0.7 },
  ],
});
assert.equal(custom.ok, true);
const customPools = Object.fromEntries(custom.allocation.pools.map((pool) => [pool.id, pool.tokens]));
assert.equal(customPools.player, 95);
assert.equal(customPools.layout, 190);
assert.equal(customPools.defenders, 665);
`;

test("director budget allocation splits pools deterministically", () => {
  runEsm(script);
});
