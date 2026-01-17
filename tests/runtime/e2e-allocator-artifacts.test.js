const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("allocator receipts and ledger link to buildspec budget refs", async () => {
  const scenario = readJson(resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json"));
  const summaryFixture = readJson(resolve(ROOT, scenario.summaryPath));
  const catalog = readJson(resolve(ROOT, scenario.catalogPath));
  const budget = readJson(resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"));
  const priceList = readJson(resolve(ROOT, "tests/fixtures/allocator/price-list-v1-basic.json"));
  const spendEvents = readJson(resolve(ROOT, "tests/fixtures/allocator/spend-events-v1-basic.json"));

  const { normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );
  const { orchestrateBuild } = await import(
    moduleUrl("packages/runtime/src/build/orchestrate-build.js")
  );
  const { updateBudgetLedger } = await import(
    moduleUrl("packages/runtime/src/personas/allocator/budget-ledger.js")
  );

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const budgetRef = {
    id: budget.meta.id,
    schema: budget.schema,
    schemaVersion: budget.schemaVersion,
  };
  const priceListRef = {
    id: priceList.meta.id,
    schema: priceList.schema,
    schemaVersion: priceList.schemaVersion,
  };

  const buildSpecResult = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "e2e_allocator",
    createdAt: "2025-01-01T00:00:00Z",
    source: "e2e-test",
    budgetRef,
    priceListRef,
    budgetArtifact: budget,
    priceListArtifact: priceList,
  });

  assert.equal(buildSpecResult.ok, true);
  assert.deepEqual(buildSpecResult.spec.budget.budgetRef, budgetRef);
  assert.deepEqual(buildSpecResult.spec.budget.priceListRef, priceListRef);

  const buildResult = await orchestrateBuild({ spec: buildSpecResult.spec, producedBy: "runtime-build" });
  assert.ok(buildResult.spendProposal);
  assert.ok(buildResult.budgetReceipt);
  assert.equal(buildResult.spendProposal.schema, "agent-kernel/SpendProposal");

  const receipt = buildResult.budgetReceipt;
  assert.equal(receipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.equal(receipt.meta.runId, buildSpecResult.spec.meta.runId);
  assert.deepEqual(receipt.budgetRef, budgetRef);
  assert.deepEqual(receipt.priceListRef, priceListRef);
  assert.equal(receipt.proposalRef?.id, buildResult.spendProposal.meta.id);

  const ledgerMeta = {
    id: "ledger_e2e",
    runId: buildSpecResult.spec.meta.runId,
    createdAt: "2025-01-01T00:00:00.000Z",
    producedBy: "allocator",
  };
  const ledgerResult = updateBudgetLedger({
    receipt,
    spendEvents: spendEvents.events,
    meta: ledgerMeta,
  });

  assert.equal(ledgerResult.ledger.schema, "agent-kernel/BudgetLedgerArtifact");
  assert.equal(ledgerResult.ledger.meta.runId, buildSpecResult.spec.meta.runId);
  assert.deepEqual(ledgerResult.ledger.budgetRef, budgetRef);
  assert.equal(ledgerResult.ledger.receiptRef.id, receipt.meta.id);
});
