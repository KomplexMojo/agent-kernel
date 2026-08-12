const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function buildWithBudget() {
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
    runId: "artifact_meta_cost_context",
    createdAt: "2026-06-11T00:00:00.000Z",
    source: "test",
    budgetRef: { id: budget.meta.id, schema: budget.schema, schemaVersion: budget.schemaVersion },
    priceListRef: { id: priceList.meta.id, schema: priceList.schema, schemaVersion: priceList.schemaVersion },
    budgetArtifact: budget,
    priceListArtifact: priceList,
  });
  assert.equal(specResult.ok, true);

  return orchestrateBuild({ spec: specResult.spec, producedBy: "runtime-build" });
}

test("orchestrateBuild attaches real cost context refs to emitted artifact metadata", async () => {
  const buildResult = await buildWithBudget();
  const cost = buildResult.simConfig.meta.cost;

  assert.equal(cost.runTotalTokens, buildResult.budgetReceipt.totalCost);
  assert.equal(cost.budgetTokens, buildResult.budgetReceipt.totalCost + buildResult.budgetReceipt.remaining);
  assert.deepEqual(cost.receiptRef, {
    id: buildResult.budgetReceipt.meta.id,
    schema: buildResult.budgetReceipt.schema,
    schemaVersion: buildResult.budgetReceipt.schemaVersion,
  });
  assert.deepEqual(cost.proposalRef, {
    id: buildResult.spendProposal.meta.id,
    schema: buildResult.spendProposal.schema,
    schemaVersion: buildResult.spendProposal.schemaVersion,
  });
});

test("orchestrateBuild applies the same real cost context to the canonical build artifacts", async () => {
  const buildResult = await buildWithBudget();
  const cost = buildResult.simConfig.meta.cost;

  [
    buildResult.spec,
    buildResult.intent,
    buildResult.plan,
    buildResult.simConfig,
    buildResult.initialState,
    buildResult.resourceBundle,
  ].forEach((artifact) => {
    assert.ok(artifact?.meta?.cost, `${artifact?.schema || "artifact"} should include meta.cost`);
    assert.deepEqual(artifact.meta.cost, cost);
  });
});
