const test = require("node:test");
const assert = require("node:assert/strict");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFixture } = require("../helpers/fixtures");

const modulePath = moduleUrl("packages/runtime/src/personas/orchestrator/budget-inputs.js");
const budgetFixture = readFixture("budget-artifact-v1-basic.json");
const priceListFixture = readFixture("price-list-artifact-v1-basic.json");

const script = `
import assert from "node:assert/strict";
import { ingestBudgetInputs } from ${JSON.stringify(modulePath)};

const fixtureBudget = ${JSON.stringify(budgetFixture)};
const fixturePriceList = ${JSON.stringify(priceListFixture)};

const fixtureResult = ingestBudgetInputs({
  fixtures: { budget: fixtureBudget, priceList: fixturePriceList },
  mode: "fixture",
  clock: () => "fixed",
});

assert.deepEqual(fixtureResult.budget, fixtureBudget);
assert.deepEqual(fixtureResult.priceList, fixturePriceList);
assert.equal(fixtureResult.errors, undefined);

const ownerRef = { id: "wallet_fixture", schema: "agent-kernel/IntentEnvelope", schemaVersion: 1 };
const budgetMeta = { id: "budget_meta", runId: "run_test", createdAt: "now", producedBy: "orchestrator" };
const priceListMeta = { id: "price_meta", runId: "run_test", createdAt: "now", producedBy: "orchestrator" };

const rawBudget = { tokens: 500, notes: "seed", ownerRef };
const rawPriceList = {
  items: [{ id: "vital_health_point", kind: "vital", costTokens: 1 }],
};

const rawResult = ingestBudgetInputs({
  budgetInput: rawBudget,
  priceListInput: rawPriceList,
  budgetMeta,
  priceListMeta,
  clock: () => "fixed",
});

assert.equal(rawResult.budget.schema, "agent-kernel/BudgetArtifact");
assert.equal(rawResult.budget.schemaVersion, 1);
assert.deepEqual(rawResult.budget.meta, budgetMeta);
assert.equal(rawResult.budget.budget.tokens, 500);
assert.deepEqual(rawResult.budget.budget.ownerRef, ownerRef);
assert.equal(rawResult.priceList.schema, "agent-kernel/PriceList");
assert.equal(rawResult.priceList.schemaVersion, 1);
assert.deepEqual(rawResult.priceList.meta, priceListMeta);
assert.deepEqual(rawResult.priceList.items, rawPriceList.items);
assert.equal(rawResult.errors, undefined);
`;

test("orchestrator ingests budget + price list inputs deterministically", () => {
  runEsm(script);
});
