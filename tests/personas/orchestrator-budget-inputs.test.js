const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const budgetFixture = readFixture("budget-artifact-v1-basic.json");
const priceListFixture = readFixture("price-list-artifact-v1-basic.json");

test("orchestrator ingests budget + price list inputs deterministically", async () => {
  const { ingestBudgetInputs } = await import(
    "../../packages/runtime/src/personas/orchestrator/budget-inputs.js"
  );

  const fixtureResult = ingestBudgetInputs({
    fixtures: { budget: budgetFixture, priceList: priceListFixture },
    mode: "fixture",
    clock: () => "fixed",
  });

  assert.deepEqual(fixtureResult.budget, budgetFixture);
  assert.deepEqual(fixtureResult.priceList, priceListFixture);
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
});
