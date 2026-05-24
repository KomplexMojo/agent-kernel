const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

async function loadValidator() {
  return import("../../packages/runtime/src/contracts/build-spec.js");
}

test("build spec validation accepts basic fixture", async () => {
  const { validateBuildSpec, BUILD_SPEC_SCHEMA } = await loadValidator();
  const spec = readFixture("build-spec-v1-basic.json");
  const result = validateBuildSpec(spec);
  assert.equal(spec.schema, BUILD_SPEC_SCHEMA);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("build spec validation rejects missing intent goal", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-missing-goal.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /intent\.goal/);
});

test("build spec validation rejects invalid adapter capture", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-invalid-adapter.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /adapters\.capture\[0\]\.adapter/);
});

test("build spec validation rejects non-object intent hints", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-intent-hints-not-object.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /intent\.hints/);
});

test("build spec validation rejects non-object configurator inputs", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-configurator-inputs-not-object.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /configurator\.inputs/);
});

test("build spec validation accepts agent authoring contract metadata", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("build-spec-v1-agent-authoring.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("build spec validation accepts deterministic agent authoring validation details", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("build-spec-v1-agent-authoring-validation.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("build spec validation rejects invalid agent authoring object kind", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-agent-authoring-invalid-kind.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /authoring\.request\.objects\[0\]\.kind/);
});

test("build spec validation rejects incomplete agent authoring compilation rules", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-agent-authoring-missing-compilation-rule.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /missing compilation rule for trap/);
});

test("build spec validation rejects invalid authoring optimization goals", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-agent-authoring-invalid-optimization-goal.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /authoring\.optimizationGoals\[0\]\.vital/);
});

test("build spec validation rejects invalid agent authoring validation details", async () => {
  const { validateBuildSpec } = await loadValidator();
  const spec = readFixture("invalid/build-spec-v1-agent-authoring-invalid-validation.json");
  const result = validateBuildSpec(spec);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /authoring\.validation\.outcome/);
  assert.match(result.errors.join("\n"), /authoring\.validation\.summary/);
});

// --- Room tile actor config contract ---

const BASE_META = {
  id: "rt1",
  runId: "r1",
  createdAt: "2026-01-01T00:00:00.000Z",
  producedBy: "test",
};

test("room tile actor config accepts affinities, motivations, durability", async () => {
  const { validateRoomTileActorConfig } = await loadValidator();
  const config = {
    schema: "agent-kernel/RoomTileActorConfig",
    schemaVersion: 1,
    meta: BASE_META,
    affinity: "dark",
    affinityStacks: 2,
    motivation: "stationary",
    durability: { kind: "regen", current: 10, max: 10, regen: 0 },
  };
  const result = validateRoomTileActorConfig(config);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
});

test("room tile actor config accepts minimal config (no affinity)", async () => {
  const { validateRoomTileActorConfig } = await loadValidator();
  const config = {
    schema: "agent-kernel/RoomTileActorConfig",
    schemaVersion: 1,
    meta: BASE_META,
  };
  const result = validateRoomTileActorConfig(config);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
});

test("room tile actor config rejects health vital", async () => {
  const { validateRoomTileActorConfig } = await loadValidator();
  const config = {
    schema: "agent-kernel/RoomTileActorConfig",
    schemaVersion: 1,
    meta: BASE_META,
    health: { kind: "regen", current: 10, max: 10, regen: 1 },
  };
  const result = validateRoomTileActorConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /health/);
});

test("room tile actor config rejects mana vital", async () => {
  const { validateRoomTileActorConfig } = await loadValidator();
  const config = {
    schema: "agent-kernel/RoomTileActorConfig",
    schemaVersion: 1,
    meta: BASE_META,
    mana: { kind: "regen", current: 4, max: 4, regen: 1 },
  };
  const result = validateRoomTileActorConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /mana/);
});

test("room tile actor config rejects stamina vital", async () => {
  const { validateRoomTileActorConfig } = await loadValidator();
  const config = {
    schema: "agent-kernel/RoomTileActorConfig",
    schemaVersion: 1,
    meta: BASE_META,
    stamina: { kind: "regen", current: 4, max: 4, regen: 1 },
  };
  const result = validateRoomTileActorConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /stamina/);
});

test("room tile actor config rejects affinity expressions", async () => {
  const { validateRoomTileActorConfig } = await loadValidator();
  const config = {
    schema: "agent-kernel/RoomTileActorConfig",
    schemaVersion: 1,
    meta: BASE_META,
    affinityExpression: "push",
  };
  const result = validateRoomTileActorConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /affinityExpression/);
});

/*
## TODO: Test Permutations
- room tile with invalid affinity kind (e.g. "thunder") should be invalid
- room tile with affinityStacks=-1 should be invalid
- room tile with affinityStacks=0 should be valid (zero stacks is valid)
- room tile with durability kind="one-time" should be valid
- room tile with region field should be invalid
- room tile with no optional fields (bare schema/schemaVersion/meta) should be valid
- room tile with motivation="stationary" should be valid
- room tile with all forbidden vitals simultaneously should report all errors
*/
