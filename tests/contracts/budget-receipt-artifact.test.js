const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const SOURCE_BACKED_SCENARIO_CATEGORIES = ["rooms", "delvers", "wardens"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function refFor(artifact) {
  return { id: artifact.meta.id, schema: artifact.schema, schemaVersion: artifact.schemaVersion };
}

async function buildReceipt() {
  const scenario = readJson(resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json"));
  const summaryFixture = readJson(resolve(ROOT, scenario.summaryPath));
  const catalog = readJson(resolve(ROOT, scenario.catalogPath));
  const budget = readJson(resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"));
  const priceList = readJson(resolve(ROOT, "tests/fixtures/allocator/price-list-v1-basic.json"));

  const [{ normalizeSummary }, { mapSummaryToPool }, { buildBuildSpecFromSummary }, { orchestrateBuild }] = await Promise.all([
    import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js"),
    import("../../packages/runtime/src/personas/director/pool-mapper.js"),
    import("../../packages/runtime/src/personas/director/buildspec-assembler.js"),
    import("../../packages/runtime/src/build/orchestrate-build.js"),
  ]);

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);
  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const specResult = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "budget_receipt_source_backed",
    createdAt: "2026-06-11T00:00:00.000Z",
    source: "test",
    budgetRef: refFor(budget),
    priceListRef: refFor(priceList),
    budgetArtifact: budget,
    priceListArtifact: priceList,
  });
  assert.equal(specResult.ok, true);

  return orchestrateBuild({ spec: specResult.spec, producedBy: "runtime-build" });
}

test("orchestrateBuild emits a real BudgetReceiptArtifact with expanded scenario spend report", async () => {
  const buildResult = await buildReceipt();
  const receipt = buildResult.budgetReceipt;

  assert.equal(receipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.proposalRef.id, buildResult.spendProposal.meta.id);
  assert.ok(receipt.scenarioSpendReport);
  assert.equal(receipt.scenarioSpendReport.budget, receipt.totalCost + receipt.remaining);
  assert.equal(receipt.scenarioSpendReport.totalSpend, receipt.totalCost);
  assert.equal(receipt.scenarioSpendReport.remainingBudget, receipt.remaining);
  assert.equal(receipt.scenarioSpendReport.overBudget, receipt.totalCost > receipt.totalCost + receipt.remaining);
  assert.ok(Number.isFinite(receipt.scenarioSpendReport.totalBudgetUsagePercent));
  assert.ok(receipt.scenarioSpendReport.incentive);
});

test("generated scenario spend report covers the categories emitted by the production incentive model", async () => {
  const buildResult = await buildReceipt();
  const categories = buildResult.budgetReceipt.scenarioSpendReport.categories;

  SOURCE_BACKED_SCENARIO_CATEGORIES.forEach((category) => {
    assert.ok(categories[category], `missing ${category}`);
    assert.equal(typeof categories[category].actual, "number");
    assert.equal(typeof categories[category].target, "number");
    assert.equal(typeof categories[category].usagePercent, "number");
  });
  assert.deepEqual(Object.keys(categories).sort(), [...SOURCE_BACKED_SCENARIO_CATEGORIES].sort());
});
