const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFixture } = require("../helpers/fixtures");

const spendModulePath = moduleUrl("packages/runtime/src/personas/allocator/layout-spend.js");
const priceList = readFixture("price-list-artifact-v1-tiles.json");

const script = `
import assert from "node:assert/strict";
import { evaluateLayoutSpend, resolveLayoutTileCosts } from ${JSON.stringify(spendModulePath)};

const priceList = ${JSON.stringify(priceList)};
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
`;

test("allocator layout spend applies tile costs and budget bounds", () => {
  runEsm(script);
});
