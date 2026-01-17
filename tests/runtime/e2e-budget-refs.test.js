const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("buildspec includes budget and price list refs from fixtures", async () => {
  const scenario = readJson(resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json"));
  const summaryFixture = readJson(resolve(ROOT, scenario.summaryPath));
  const catalog = readJson(resolve(ROOT, scenario.catalogPath));

  const budgetFixture = readJson(resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"));
  const priceListFixture = readJson(resolve(ROOT, "tests/fixtures/adapters/ipfs-price-list.json"));

  const { normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const budgetRef = {
    id: budgetFixture.meta.id,
    schema: budgetFixture.schema,
    schemaVersion: budgetFixture.schemaVersion,
  };
  const priceListRef = {
    id: priceListFixture.meta.id,
    schema: priceListFixture.schema,
    schemaVersion: priceListFixture.schemaVersion,
  };

  const result = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "e2e_budget_refs",
    createdAt: "2025-01-01T00:00:00Z",
    source: "e2e-test",
    budgetRef,
    priceListRef,
  });

  assert.equal(result.ok, true);
  assert.ok(result.spec.budget);
  assert.deepEqual(result.spec.budget.budgetRef, budgetRef);
  assert.deepEqual(result.spec.budget.priceListRef, priceListRef);
});
