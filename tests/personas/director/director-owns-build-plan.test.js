/**
 * P2.1c — the Director owns PlanArtifact production for EVERY build path.
 *
 * Before P2.1c, build/map-build-spec.js (glue) fabricated a near-duplicate
 * PlanArtifact inline (producedBy "cli-*", `${specId}_plan` id) — the persona
 * whose whole job is intent→plan translation never touched the persisted plan.
 * P2.1c routes mapBuildSpecToArtifacts's plan through the Director so the plan
 * announces its persona producer (charter — "Persona Model — ENFORCED").
 *
 * Maintainer decision 2026-07-20: A — Director provenance (plan.meta.producedBy
 * → "director"). Refined 2026-07-22: the plan id stays the glue scheme
 * `${specId}_plan` rather than the Director's native `plan_${runId}_N`, because
 * that id is the one part of the plan that reaches default output (sim-config
 * embeds planRef = toRef(plan)) — pinning it keeps the goldens byte-identical
 * while producedBy still announces the producer. The Director-derived plan
 * content (directives/theme/correlationId) lives only in the emit-intermediates
 * plan.json, which has no goldens and no consumer beyond toRef.
 */
const assert = require("node:assert/strict");
const { readFixture } = require("../../helpers/fixtures");

async function loadMapper() {
  return import("../../../packages/runtime/src/build/map-build-spec.js");
}

test("mapBuildSpecToArtifacts's plan is produced by the Director", async () => {
  const { mapBuildSpecToArtifacts } = await loadMapper();
  const spec = readFixture("build-spec-v1-basic.json");

  const { plan } = mapBuildSpecToArtifacts(spec, { producedBy: "cli-create" });

  assert.equal(plan.schema, "agent-kernel/PlanArtifact");
  assert.equal(plan.schemaVersion, 1);
  // Provenance is the Director's, not the glue producer we passed in.
  assert.equal(plan.meta.producedBy, "director");
  // The id stays glue-scheme so planRef in sim-config.json is byte-identical.
  assert.equal(plan.meta.id, `${spec.meta.id}_plan`);
  assert.equal(plan.meta.runId, spec.meta.runId);
  assert.equal(plan.meta.createdAt, spec.meta.createdAt);
});

test("the plan links back to the emitted IntentEnvelope", async () => {
  const { mapBuildSpecToArtifacts } = await loadMapper();
  const spec = readFixture("build-spec-v1-basic.json");

  const { intent, plan } = mapBuildSpecToArtifacts(spec);

  assert.equal(plan.intentRef.id, intent.meta.id);
  assert.equal(plan.intentRef.schema, intent.schema);
  assert.equal(plan.intentRef.schemaVersion, intent.schemaVersion);
  // The Director correlates the plan to its intent.
  assert.equal(plan.meta.correlationId, intent.meta.id);
});

test("the goal survives translation into the plan objective", async () => {
  const { mapBuildSpecToArtifacts } = await loadMapper();
  const spec = readFixture("build-spec-v1-basic.json");

  const { plan } = mapBuildSpecToArtifacts(spec);

  assert.equal(plan.plan.objectives[0].description, spec.intent.goal);
  assert.equal(plan.plan.objectives[0].priority, 1);
});

test("the Director derives directives from the intent hints, and theme from intent tags", async () => {
  const { mapBuildSpecToArtifacts } = await loadMapper();
  const spec = readFixture("build-spec-v1-basic.json");
  // Give the intent tags so the Director's theme branch is exercised.
  const tagged = { ...spec, intent: { ...spec.intent, tags: ["fire"] } };

  const { plan } = mapBuildSpecToArtifacts(tagged);

  // Directives now come from intent.hints (Director model), not spec.plan.hints.
  assert.deepEqual(plan.directives, spec.intent.hints);
  assert.deepEqual(plan.plan.theme.tags, ["fire"]);
});

// ## TODO: Test Permutations
// - a spec whose intent has no hints: plan has no `directives` key
// - a spec whose intent has no tags: plan has no `theme`
// - two specs with the same runId produce the same plan id (deterministic)
// - a spec goal that is blank: objective description falls back to the ref id
