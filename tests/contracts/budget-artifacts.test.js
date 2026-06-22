const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function refFor(artifact) {
  return { id: artifact.meta.id, schema: artifact.schema, schemaVersion: artifact.schemaVersion };
}

async function buildBudgetedRun() {
  const scenario = readJson(resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json"));
  const summaryFixture = readJson(resolve(ROOT, scenario.summaryPath));
  const catalog = readJson(resolve(ROOT, scenario.catalogPath));
  const budget = readJson(resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"));
  const priceList = readJson(resolve(ROOT, "tests/fixtures/allocator/price-list-v1-basic.json"));
  const spendEvents = readJson(resolve(ROOT, "tests/fixtures/allocator/spend-events-v1-basic.json"));

  const [
    { normalizeSummary },
    { mapSummaryToPool },
    { buildBuildSpecFromSummary },
    { orchestrateBuild },
    { updateBudgetLedger },
  ] = await Promise.all([
    import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js"),
    import("../../packages/runtime/src/personas/director/pool-mapper.js"),
    import("../../packages/runtime/src/personas/director/buildspec-assembler.js"),
    import("../../packages/runtime/src/build/orchestrate-build.js"),
    import("../../packages/runtime/src/personas/allocator/budget-ledger.js"),
  ]);

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);
  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const specResult = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "budget_artifacts_source_backed",
    createdAt: "2026-06-11T00:00:00.000Z",
    source: "test",
    budgetRef: refFor(budget),
    priceListRef: refFor(priceList),
    budgetArtifact: budget,
    priceListArtifact: priceList,
  });
  assert.equal(specResult.ok, true);

  const buildResult = await orchestrateBuild({ spec: specResult.spec, producedBy: "runtime-build" });
  const ledgerResult = updateBudgetLedger({
    receipt: buildResult.budgetReceipt,
    spendEvents: spendEvents.events,
    meta: {
      id: "ledger_budget_artifacts_source_backed",
      runId: specResult.spec.meta.runId,
      createdAt: "2026-06-11T00:00:00.000Z",
      producedBy: "allocator",
    },
  });

  return { budget, priceList, buildResult, ledger: ledgerResult.ledger };
}

test("orchestrateBuild produces budget receipt refs and totals from real budget artifacts", async () => {
  const { budget, priceList, buildResult } = await buildBudgetedRun();
  const receipt = buildResult.budgetReceipt;

  assert.equal(receipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.deepEqual(receipt.budgetRef, refFor(budget));
  assert.deepEqual(receipt.priceListRef, refFor(priceList));
  assert.equal(receipt.proposalRef.id, buildResult.spendProposal.meta.id);
  assert.ok(["approved", "denied", "partial"].includes(receipt.status));
  assert.equal(receipt.totalCost + receipt.remaining, budget.budget.tokens);
  assert.ok(receipt.lineItems.length > 0);
});

test("updateBudgetLedger creates a real ledger linked to the generated receipt", async () => {
  const { budget, buildResult, ledger } = await buildBudgetedRun();
  const expectedEventSpend = ledger.spendEvents.reduce((sum, event) => sum + event.totalCost, 0);

  assert.equal(ledger.schema, "agent-kernel/BudgetLedgerArtifact");
  assert.deepEqual(ledger.budgetRef, refFor(budget));
  assert.equal(ledger.receiptRef.id, buildResult.budgetReceipt.meta.id);
  assert.ok(Array.isArray(ledger.spendEvents));
  assert.ok(ledger.spendEvents.length > 0);
  assert.equal(ledger.remaining, buildResult.budgetReceipt.remaining - expectedEventSpend);
});
