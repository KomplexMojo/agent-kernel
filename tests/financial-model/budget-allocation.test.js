const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const budgetAllocUrl = moduleUrl("packages/runtime/src/personas/director/budget-allocation.js");

test("default pool weights: 55% rooms, 20% delvers, 25% wardens (design §2.2)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeBudgetPools, REFERENCE_BUDGET_TOKENS } from ${JSON.stringify(budgetAllocUrl)};

const result = computeBudgetPools({ budgetTokens: 1000 });
assert.ok(result.ok);

const poolMap = new Map(result.pools.map(p => [p.id, p.tokens]));
assert.equal(poolMap.get("layout"), 550);
assert.equal(poolMap.get("player"), 200);
assert.equal(poolMap.get("wardens"), 250);
`);
});

test("reference budget constant is 1000 (design §2.1)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { REFERENCE_BUDGET_TOKENS } from ${JSON.stringify(budgetAllocUrl)};

assert.equal(REFERENCE_BUDGET_TOKENS, 1000);
`);
});

test("custom pool weights override defaults", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeBudgetPools } from ${JSON.stringify(budgetAllocUrl)};

const result = computeBudgetPools({
  budgetTokens: 800,
  poolWeights: [
    { id: "layout", weight: 0.60 },
    { id: "player", weight: 0.15 },
    { id: "wardens", weight: 0.25 }
  ]
});
assert.ok(result.ok);

const poolMap = new Map(result.pools.map(p => [p.id, p.tokens]));
assert.equal(poolMap.get("layout"), 480);
assert.equal(poolMap.get("player"), 120);
assert.equal(poolMap.get("wardens"), 200);
`);
});
