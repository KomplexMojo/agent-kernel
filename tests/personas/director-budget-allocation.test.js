const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFixture } = require("../helpers/fixtures");

const modulePath = moduleUrl("packages/runtime/src/personas/director/budget-allocation.js");
const budgetFixture = readFixture("budget-artifact-v1-basic.json");
const priceListFixture = readFixture("price-list-artifact-v1-basic.json");

const script = `
import assert from "node:assert/strict";
import { buildBudgetAllocation, REFERENCE_BUDGET_TOKENS, DEFAULT_DUNGEON_PCT, DEFAULT_DELVER_PCT, DEFAULT_DUNGEON_SUB_POOLS } from ${JSON.stringify(modulePath)};

// Verify exported constants
assert.equal(REFERENCE_BUDGET_TOKENS, 2500);
assert.equal(DEFAULT_DUNGEON_PCT, 0.80);
assert.equal(DEFAULT_DELVER_PCT, 0.20);
assert.equal(DEFAULT_DUNGEON_SUB_POOLS.length, 4);
assert.equal(DEFAULT_DUNGEON_SUB_POOLS.find(p => p.id === "rooms").weight, 0.55);
assert.equal(DEFAULT_DUNGEON_SUB_POOLS.find(p => p.id === "hazards").weight, 0.15);
assert.equal(DEFAULT_DUNGEON_SUB_POOLS.find(p => p.id === "wardens").weight, 0.20);
assert.equal(DEFAULT_DUNGEON_SUB_POOLS.find(p => p.id === "resources").weight, 0.10);

const budget = ${JSON.stringify(budgetFixture)};
const priceList = ${JSON.stringify(priceListFixture)};
const meta = {
  id: "allocation_basic",
  runId: "run_fixture",
  createdAt: "2025-01-01T00:00:00.000Z",
  producedBy: "director",
};

// budget.budget.tokens = 1000, reserve = 100, available = 900
// Default flat weights: rooms=0.44, hazards=0.12, wardens=0.16, resources=0.08, delver=0.20
// rooms=396, hazards=108, wardens=144, resources=72, delver=180 (total=900)
// Resource cap: 72 <= 108+144=252 — no redistribution
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
assert.equal(poolsById.rooms, 396);
assert.equal(poolsById.hazards, 108);
assert.equal(poolsById.wardens, 144);
assert.equal(poolsById.resources, 72);
assert.equal(poolsById.delver, 180);
assert.equal(result.dungeonTokens, 396 + 108 + 144 + 72);
assert.equal(result.delverTokens, 180);

// Custom pool weights — explicit 5-pool override; available = 1000-50=950
// pools: rooms=0.2, hazards=0.12, wardens=0.7, resources=0.08, delver=0.1 (total=1.2)
// rooms=floor(0.2/1.2*950)=floor(158.33)=158, hazards=floor(0.12/1.2*950)=floor(95)=95
// wardens=floor(0.7/1.2*950)=floor(554.17)=554, resources=floor(0.08/1.2*950)=floor(63.33)=63
// delver=floor(0.1/1.2*950)=floor(79.17)=79, total=949, remaining=1
// Remainders: rooms=0.33, resources=0.33, wardens=0.17, delver=0.17, hazards=0
// sorted by remainder desc, ties broken by id asc: "resources" < "rooms" → resources gets +1
// Final: rooms=158, hazards=95, wardens=554, resources=64, delver=79
const custom = buildBudgetAllocation({
  budget,
  priceList,
  meta,
  policy: { reserveTokens: 50 },
  poolWeights: [
    { id: "rooms", weight: 0.2 },
    { id: "hazards", weight: 0.12 },
    { id: "wardens", weight: 0.7 },
    { id: "resources", weight: 0.08 },
    { id: "delver", weight: 0.1 },
  ],
});
assert.equal(custom.ok, true);
const customPools = Object.fromEntries(custom.allocation.pools.map((pool) => [pool.id, pool.tokens]));
assert.equal(customPools.rooms, 158);
assert.equal(customPools.hazards, 95);
assert.equal(customPools.wardens, 554);
assert.equal(customPools.resources, 64);
assert.equal(customPools.delver, 79);

// Resource cap test: set resources weight very high so it would exceed hazards+wardens
// Use poolWeights: rooms=0.1, hazards=0.1, wardens=0.1, resources=0.6, delver=0.1 (total=1.0)
// available = 900: rooms=90, hazards=90, wardens=90, resources=540, delver=90
// Resource cap: 540 > 90+90=180 → excess=360 → resources=180, rooms=90+360=450
const capped = buildBudgetAllocation({
  budget,
  priceList,
  meta,
  policy: { reserveTokens: 100 },
  poolWeights: [
    { id: "rooms", weight: 0.1 },
    { id: "hazards", weight: 0.1 },
    { id: "wardens", weight: 0.1 },
    { id: "resources", weight: 0.6 },
    { id: "delver", weight: 0.1 },
  ],
});
assert.equal(capped.ok, true);
const cappedPools = Object.fromEntries(capped.allocation.pools.map((p) => [p.id, p.tokens]));
assert.equal(cappedPools.resources, 180, "resources capped at hazards+wardens");
assert.equal(cappedPools.rooms, 450, "excess resources redistributed to rooms");
assert.equal(cappedPools.hazards, 90);
assert.equal(cappedPools.wardens, 90);
assert.equal(cappedPools.delver, 90);
`;

test("director budget allocation splits pools deterministically", () => {
  runEsm(script);
});
