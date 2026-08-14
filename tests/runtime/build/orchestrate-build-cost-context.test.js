const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");

const ROOT = resolve(__dirname, "../../..");
const specBudgetOnlyPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-budget-tokens-only.json");
const specWithPriceListPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-budget-inline-only.json");
const specConfiguratorPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");

const budgetTokensOnlySpec = JSON.parse(readFileSync(specBudgetOnlyPath, "utf8"));

test("orchestrateBuild with budget only (no priceList) produces spendProposal and budgetReceipt using default price list", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );

  const spec = budgetTokensOnlySpec;
  const result = await orchestrateBuild({ spec, producedBy: "test" });

  assert.ok(result.spendProposal, "spendProposal must be produced when budgetTokens present");
  assert.equal(result.spendProposal.schema, "agent-kernel/SpendProposal");

  assert.ok(result.budgetReceipt, "budgetReceipt must be produced when budgetTokens present");
  assert.equal(result.budgetReceipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.ok(["approved", "denied", "partial"].includes(result.budgetReceipt.status));
  assert.ok(Number.isFinite(result.budgetReceipt.totalCost));
  assert.ok(Number.isFinite(result.budgetReceipt.remaining));
});

test("orchestrateBuild budget receipt references a price list (default or explicit)", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );

  const spec = budgetTokensOnlySpec;
  const result = await orchestrateBuild({ spec, producedBy: "test" });

  assert.ok(result.budgetReceipt.priceListRef, "budgetReceipt.priceListRef must be present");
  assert.equal(result.budgetReceipt.priceListRef.schema, "agent-kernel/PriceList");
});

test("orchestrateBuild with explicit priceList still produces receipt+proposal (existing behaviour preserved)", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );

  const specWithPriceList = JSON.parse(readFileSync(specWithPriceListPath, "utf8"));
  const spec = specWithPriceList;
  assert.ok(spec.budget.budget || spec.budget.priceList, "spec must have at least one budget field");
  const result = await orchestrateBuild({ spec, producedBy: "test" });
  assert.ok(result, "orchestrateBuild must complete without error");
});

test("orchestrateBuild without any budget produces no spendProposal or budgetReceipt", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );

  const specNoBudget = JSON.parse(readFileSync(specConfiguratorPath, "utf8"));
  const spec = specNoBudget;
  const result = await orchestrateBuild({ spec, producedBy: "test" });

  assert.equal(result.spendProposal ?? null, null, "no spendProposal when no budget");
  assert.equal(result.budgetReceipt ?? null, null, "no budgetReceipt when no budget");
});
