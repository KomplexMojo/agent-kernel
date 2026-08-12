const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const priceList = readFixture("price-list-artifact-v1-tiles.json");


test("allocator layout spend applies tile costs and budget bounds", async () => {
const { evaluateLayoutSpend, resolveLayoutTileCosts } = await import("../../packages/runtime/src/personas/allocator/layout-spend.js");

const layout = { floorTiles: 3, hallwayTiles: 1 };

const costs = resolveLayoutTileCosts(priceList);
assert.equal(costs.costs.floorTiles, 1);
assert.equal(costs.costs.hallwayTiles, 3);

const spend = evaluateLayoutSpend({ layout, budgetTokens: 12, priceList });
assert.equal(spend.spentTokens, 3);
assert.equal(spend.remainingBudgetTokens, 9);
assert.equal(spend.overBudget, false);
assert.equal(spend.layout.floorTiles, 3);
assert.equal(spend.layout.hallwayTiles, 0);
assert.ok(spend.warnings?.some((warn) => warn.code === "deprecated_hallway_tiles_ignored"));

const over = evaluateLayoutSpend({ layout, budgetTokens: 5, priceList });
assert.equal(over.overBudget, false);
assert.equal(over.remainingBudgetTokens, 2);
});
