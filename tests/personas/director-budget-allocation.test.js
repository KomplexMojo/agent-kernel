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

const allocation = buildBudgetAllocation({
  budget,
  priceList,
  meta,
  policy: { reserveTokens: 100, maxActorSpend: 300 },
});

assert.equal(allocation.schema, "agent-kernel/BudgetAllocationArtifact");
assert.equal(allocation.schemaVersion, 1);
assert.deepEqual(allocation.meta, meta);
assert.equal(allocation.budgetRef.schema, "agent-kernel/BudgetArtifact");
assert.equal(allocation.priceListRef.schema, "agent-kernel/PriceList");
assert.deepEqual(allocation.policy, { reserveTokens: 100, maxActorSpend: 300 });

const poolsById = Object.fromEntries(allocation.pools.map((pool) => [pool.id, pool.tokens]));
assert.equal(poolsById.layout, 360);
assert.equal(poolsById.actors, 360);
assert.equal(poolsById.affinity_motivation, 180);
`;

test("director budget allocation splits pools deterministically", () => {
  runEsm(script);
});
