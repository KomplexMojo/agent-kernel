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
assert.equal(spend.spentTokens, 6);
assert.equal(spend.remainingBudgetTokens, 6);
assert.equal(spend.overBudget, false);
assert.equal(spend.layout.floorTiles, 3);
assert.equal(spend.layout.hallwayTiles, 1);

const over = evaluateLayoutSpend({ layout, budgetTokens: 5, priceList });
assert.equal(over.overBudget, true);
assert.equal(over.remainingBudgetTokens, 0);
assert.ok(over.warnings?.some((warn) => warn.code === "layout_over_budget"));
`;

test("allocator layout spend applies tile costs and budget bounds", () => {
  runEsm(script);
});
