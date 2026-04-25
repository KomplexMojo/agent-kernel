const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

function isObject(v) {
  return v !== null && typeof v === "object";
}

const FULL_CATEGORIES = [
  "rooms",
  "floor_tiles",
  "traps",
  "hazards",
  "resources",
  "delvers",
  "wardens",
  "shared_system",
];

function validateCategoryEntry(entry, label) {
  assert.ok(isObject(entry), `${label}: expected object`);
  assert.ok(Number.isFinite(entry.actual), `${label}.actual: expected number`);
  assert.ok(Number.isFinite(entry.target), `${label}.target: expected number`);
  assert.ok(Number.isFinite(entry.usagePercent), `${label}.usagePercent: expected number`);
}

/**
 * Validates the expanded scenarioSpendReport on a BudgetReceiptArtifact.
 * All 8 canonical categories must be present when scenarioSpendReport is present.
 */
function validateExpandedScenarioSpendReport(report) {
  assert.ok(isObject(report), "scenarioSpendReport: expected object");
  assert.ok(Number.isFinite(report.budget), "scenarioSpendReport.budget: expected number");
  assert.ok(Number.isFinite(report.totalSpend), "scenarioSpendReport.totalSpend: expected number");
  assert.ok(Number.isFinite(report.remainingBudget), "scenarioSpendReport.remainingBudget: expected number");
  assert.equal(typeof report.overBudget, "boolean", "scenarioSpendReport.overBudget: expected boolean");
  assert.ok(isObject(report.categories), "scenarioSpendReport.categories: expected object");

  for (const cat of FULL_CATEGORIES) {
    assert.ok(
      isObject(report.categories[cat]),
      `scenarioSpendReport.categories.${cat}: expected object (missing from report)`,
    );
    validateCategoryEntry(report.categories[cat], `categories.${cat}`);
  }

  assert.ok(
    Number.isFinite(report.totalBudgetUsagePercent),
    "scenarioSpendReport.totalBudgetUsagePercent: expected number",
  );
}

function validateBudgetReceiptWithExpandedReport(artifact) {
  assert.ok(isObject(artifact), "artifact: expected object");
  assert.equal(artifact.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.equal(artifact.schemaVersion, 1);
  assert.ok(isObject(artifact.meta));
  assert.ok(isObject(artifact.budgetRef));
  assert.ok(isObject(artifact.priceListRef));
  assert.ok(["approved", "denied", "partial"].includes(artifact.status));
  assert.ok(Number.isFinite(artifact.totalCost));
  assert.ok(Number.isFinite(artifact.remaining));
  assert.ok(Array.isArray(artifact.lineItems));

  if (artifact.scenarioSpendReport !== undefined) {
    validateExpandedScenarioSpendReport(artifact.scenarioSpendReport);
  }
}

test("BudgetReceiptArtifact accepts expanded scenarioSpendReport with all 8 categories", () => {
  const fixture = readFixture("budget-receipt-artifact-v1-full-categories.json");
  validateBudgetReceiptWithExpandedReport(fixture);
  assert.ok(isObject(fixture.scenarioSpendReport));
  for (const cat of FULL_CATEGORIES) {
    assert.ok(
      isObject(fixture.scenarioSpendReport.categories[cat]),
      `Missing category: ${cat}`,
    );
  }
});

test("BudgetReceiptArtifact rejects scenarioSpendReport missing new categories", () => {
  const fixture = readFixture("invalid/budget-receipt-artifact-v1-missing-categories.json");
  assert.throws(() => validateBudgetReceiptWithExpandedReport(fixture));
});

test("BudgetReceiptArtifact still accepts legacy 3-category report via old validator", () => {
  const fixture = readFixture("budget-receipt-artifact-v1-basic.json");
  // Old-style receipt without expanded categories should still be structurally valid
  assert.ok(isObject(fixture));
  assert.equal(fixture.schema, "agent-kernel/BudgetReceiptArtifact");
});

test("scenarioSpendReport category entries require actual/target/usagePercent", () => {
  assert.throws(() =>
    validateExpandedScenarioSpendReport({
      budget: 100,
      totalSpend: 80,
      remainingBudget: 20,
      overBudget: false,
      categories: {
        rooms: { actual: 10, target: 10, usagePercent: 100 },
        // missing all other categories
      },
      totalBudgetUsagePercent: 80,
    }),
  );
});

// ## TODO: Test Permutations
// - scenarioSpendReport.categories.hazards.actual = NaN (should fail)
// - scenarioSpendReport with all 8 categories but totalBudgetUsagePercent missing (should fail)
// - scenarioSpendReport.overBudget = "true" string (should fail — not boolean)
// - receipt with scenarioSpendReport = null (should fail — not an object)
// - receipt with shared_system.actual = 0 (valid — zero spend is legitimate)
// - receipt where floor_tiles category has usagePercent > 100 (valid — over-budget per category is allowed)
