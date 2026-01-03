const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

function isObject(value) {
  return value !== null && typeof value === "object";
}

function validateBudgetArtifact(artifact) {
  assert.ok(isObject(artifact));
  assert.equal(artifact.schema, "agent-kernel/BudgetArtifact");
  assert.equal(artifact.schemaVersion, 1);
  assert.ok(isObject(artifact.meta));
  assert.ok(isObject(artifact.budget));
  assert.equal(Number.isInteger(artifact.budget.tokens), true);
}

function isLegacyPriceItem(item) {
  return typeof item.key === "string" && Number.isFinite(item.unitCost);
}

function isTokenPriceItem(item) {
  return typeof item.id === "string" && typeof item.kind === "string" && Number.isFinite(item.costTokens);
}

function validatePriceListArtifact(artifact) {
  assert.ok(isObject(artifact));
  assert.equal(artifact.schema, "agent-kernel/PriceList");
  assert.equal(artifact.schemaVersion, 1);
  assert.ok(isObject(artifact.meta));
  assert.ok(Array.isArray(artifact.items));
  assert.ok(artifact.items.length > 0);
  artifact.items.forEach((item) => {
    assert.ok(isLegacyPriceItem(item) || isTokenPriceItem(item));
  });
}

function validateBudgetReceiptArtifact(artifact) {
  assert.ok(isObject(artifact));
  assert.equal(artifact.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.equal(artifact.schemaVersion, 1);
  assert.ok(isObject(artifact.meta));
  assert.ok(isObject(artifact.budgetRef));
  assert.ok(isObject(artifact.priceListRef));
  assert.ok(["approved", "denied", "partial"].includes(artifact.status));
  assert.equal(Number.isFinite(artifact.totalCost), true);
  assert.equal(Number.isFinite(artifact.remaining), true);
  assert.ok(Array.isArray(artifact.lineItems));
  artifact.lineItems.forEach((item) => {
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.kind, "string");
    assert.equal(Number.isFinite(item.quantity), true);
    assert.equal(Number.isFinite(item.unitCost), true);
    assert.equal(Number.isFinite(item.totalCost), true);
    assert.ok(["approved", "denied", "partial"].includes(item.status));
  });
  if (artifact.status === "approved") {
    assert.equal(artifact.remaining >= 0, true);
  }
}

function validateBudgetLedgerArtifact(artifact) {
  assert.ok(isObject(artifact));
  assert.equal(artifact.schema, "agent-kernel/BudgetLedgerArtifact");
  assert.equal(artifact.schemaVersion, 1);
  assert.ok(isObject(artifact.meta));
  assert.ok(isObject(artifact.budgetRef));
  assert.equal(Number.isFinite(artifact.remaining), true);
  assert.ok(Array.isArray(artifact.spendEvents));
  artifact.spendEvents.forEach((event) => {
    assert.equal(typeof event.id, "string");
    assert.equal(typeof event.kind, "string");
    assert.equal(Number.isFinite(event.quantity), true);
    assert.equal(Number.isFinite(event.unitCost), true);
    assert.equal(Number.isFinite(event.totalCost), true);
  });
}

test("budget artifacts accept valid shapes", () => {
  const budget = readFixture("budget-artifact-v1-basic.json");
  const priceList = readFixture("price-list-artifact-v1-basic.json");
  const receipt = readFixture("budget-receipt-artifact-v1-basic.json");
  const ledger = readFixture("budget-ledger-artifact-v1-basic.json");

  validateBudgetArtifact(budget);
  validatePriceListArtifact(priceList);
  validateBudgetReceiptArtifact(receipt);
  validateBudgetLedgerArtifact(ledger);
});

test("budget artifacts reject missing costs or status", () => {
  const priceListMissingCost = readFixture("invalid/price-list-artifact-v1-missing-cost.json");
  assert.throws(() => validatePriceListArtifact(priceListMissingCost));

  const receiptMissingStatus = readFixture("invalid/budget-receipt-artifact-v1-missing-status.json");
  assert.throws(() => validateBudgetReceiptArtifact(receiptMissingStatus));
});

test("budget receipts reject negative remaining when approved", () => {
  const overBudget = readFixture("invalid/budget-receipt-artifact-v1-over-budget.json");
  assert.throws(() => validateBudgetReceiptArtifact(overBudget));
});
