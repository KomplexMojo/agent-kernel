const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const priceList = readFixture("price-list-artifact-v1-tiles.json");


test("allocator layout spend applies tile costs and budget bounds", async () => {
const { evaluateLayoutSpend, resolveLayoutTileCosts } = await import("../../packages/runtime/src/personas/allocator/layout-spend.js");

const layout = { floorTiles: 3, hallwayTiles: 1 };

// This fixture list deliberately keeps the OLD divergent hallway price (3). The default
// list now prices a hallway at 1, like a floor tile; an injected list still wins, which is
// what this asserts. CR.9 M5 changed which prices exist, not who may override them.
const costs = resolveLayoutTileCosts(priceList);
assert.equal(costs.costs.floorTiles, 1);
assert.equal(costs.costs.hallwayTiles, 3);

// CR.9 M5: hallway tiles used to be zeroed here (`deprecated_hallway_tiles_ignored`) and
// the spend was 3 for this layout — the hallway was free. It is walkable area and is
// charged: 3 floor × 1 + 1 hallway × 3 = 6.
const spend = evaluateLayoutSpend({ layout, budgetTokens: 12, priceList });
assert.equal(spend.spentTokens, 6);
assert.equal(spend.remainingBudgetTokens, 6);
assert.equal(spend.overBudget, false);
assert.equal(spend.layout.floorTiles, 3);
assert.equal(spend.layout.hallwayTiles, 1);
assert.ok(!(spend.warnings || []).some((warn) => warn.code === "deprecated_hallway_tiles_ignored"));

const over = evaluateLayoutSpend({ layout, budgetTokens: 5, priceList });
assert.equal(over.overBudget, true, "6 tokens of tiles against a 5-token budget is over");
assert.equal(over.remainingBudgetTokens, 0);
});
