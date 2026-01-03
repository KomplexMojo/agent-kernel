const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl } = require("../helpers/esm-runner");

async function loadMapper() {
  return import(moduleUrl("packages/adapters-cli/src/build-spec/map.js"));
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
  assert.equal(mapped.plan.intentRef.id, mapped.intent.meta.id);
  assert.equal(mapped.plan.intentRef.schema, mapped.intent.schema);
  assert.equal(mapped.plan.plan.objectives[0].description, spec.intent.goal);
  assert.deepEqual(mapped.plan.directives, spec.plan.hints);

  assert.deepEqual(mapped.configuratorInputs, spec.configurator.inputs);
});

test("map build spec budget prefers refs over inline", async () => {
  const { mapBuildSpecToArtifacts } = await loadMapper();
  const spec = readFixture("build-spec-v1-budget-inline.json");

  const mapped = mapBuildSpecToArtifacts(spec);

  assert.equal(mapped.budget.budgetRef.id, "budget_ref");
  assert.equal(mapped.budget.priceListRef.id, "price_ref");
  assert.equal(mapped.budget.budget, undefined);
  assert.equal(mapped.budget.priceList, undefined);
});
