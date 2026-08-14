const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

// Imports the canonical mapper directly. This used to go through
// packages/adapters-cli/src/build-spec/map.js, a one-line re-export whose only
// caller was this test; the indirection is gone with it.
async function loadMapper() {
  return import("../../packages/runtime/src/build/map-build-spec.js");
}

test("map build spec to intent + plan artifacts", async () => {
  const { mapBuildSpecToArtifacts } = await loadMapper();
  const spec = readFixture("build-spec-v1-basic.json");

  const mapped = mapBuildSpecToArtifacts(spec, { producedBy: "cli-build-spec" });

  assert.equal(mapped.intent.schema, "agent-kernel/IntentEnvelope");
  assert.equal(mapped.intent.schemaVersion, 1);
  assert.equal(mapped.intent.meta.runId, spec.meta.runId);
  assert.equal(mapped.intent.meta.producedBy, "cli-build-spec");
  assert.equal(mapped.intent.source, spec.meta.source);
  assert.equal(mapped.intent.intent.goal, spec.intent.goal);
  assert.deepEqual(mapped.intent.intent.hints, spec.intent.hints);

  assert.equal(mapped.plan.schema, "agent-kernel/PlanArtifact");
  assert.equal(mapped.plan.schemaVersion, 1);
  // P2.1c: the Director owns plan production and stamps its own provenance.
  assert.equal(mapped.plan.meta.producedBy, "director");
  assert.equal(mapped.plan.intentRef.id, mapped.intent.meta.id);
  assert.equal(mapped.plan.intentRef.schema, mapped.intent.schema);
  assert.equal(mapped.plan.plan.objectives[0].description, spec.intent.goal);
  // Directives derive from the intent (Director model), not spec.plan.hints.
  assert.deepEqual(mapped.plan.directives, spec.intent.hints);

  assert.deepEqual(mapped.configuratorInputs, spec.configurator.inputs);
});

test("map build spec budget keeps refs and inline artifacts", async () => {
  const { mapBuildSpecToArtifacts } = await loadMapper();
  const spec = readFixture("build-spec-v1-budget-inline.json");

  const mapped = mapBuildSpecToArtifacts(spec);

  assert.equal(mapped.budget.budgetRef.id, "budget_ref");
  assert.equal(mapped.budget.priceListRef.id, "price_ref");
  assert.deepEqual(mapped.budget.budget, spec.budget.budget);
  assert.deepEqual(mapped.budget.priceList, spec.budget.priceList);
});
