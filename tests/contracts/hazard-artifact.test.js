const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

async function loadValidator() {
  return import("../../packages/runtime/src/contracts/build-spec.js");
}

test("hazard artifact validation accepts regen vital fixture", async () => {
  const { validateHazardArtifact, HAZARD_ARTIFACT_SCHEMA } = await loadValidator();
  const artifact = readFixture("hazard-artifact-v1-basic.json");
  const result = validateHazardArtifact(artifact);
  assert.equal(artifact.schema, HAZARD_ARTIFACT_SCHEMA);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("hazard artifact validation accepts one-time vital fixture", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = readFixture("hazard-artifact-v1-one-time.json");
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("hazard artifact validation rejects missing affinity", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = readFixture("invalid/hazard-artifact-v1-missing-affinity.json");
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /affinity/);
});

test("hazard artifact validation rejects invalid affinity kind", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = readFixture("invalid/hazard-artifact-v1-invalid-affinity.json");
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /affinity/);
});

test("hazard artifact V2 validation rejects durability field (fixture)", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = readFixture("invalid/hazard-artifact-v2.json");
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /durability/);
});

// --- V2 remains accepted for compatibility; V3 is the canonical public hazard contract. ---

const BASE_META = {
  id: "h1",
  runId: "r1",
  createdAt: "2026-01-01T00:00:00.000Z",
  producedBy: "test",
};

test("hazard artifact V2 is valid with mana only (no durability)", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/HazardArtifact",
    schemaVersion: 2,
    meta: BASE_META,
    affinity: "fire",
    expression: "emit",
    mana: { kind: "regen", current: 4, max: 4, regen: 1 },
  };
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, true, `Expected ok:true, got errors: ${result.errors.join("; ")}`);
});

test("hazard artifact V2 rejects durability field", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/HazardArtifact",
    schemaVersion: 2,
    meta: BASE_META,
    affinity: "fire",
    expression: "emit",
    mana: { kind: "regen", current: 4, max: 4, regen: 1 },
    durability: { kind: "regen", current: 10, max: 10, regen: 0 },
  };
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /durability/);
});

test("hazard artifact V3 accepts canonical affinity stacks and vitals fixture", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = readFixture("hazard-artifact-v3-basic.json");
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, true, `Expected ok:true, got errors: ${result.errors.join("; ")}`);
  assert.equal(artifact.affinityStacks[0].kind, "fire");
  assert.equal(artifact.affinityStacks[0].expression, "emit");
  assert.equal(artifact.affinityStacks[0].stacks, 2);
  assert.equal(artifact.vitals.mana.regen, 1);
  assert.equal(artifact.vitals.durability.kind, "one-time");
});

test("hazard artifact V3 rejects invalid mana regen shape", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const result = validateHazardArtifact(readFixture("invalid/hazard-artifact-v3-invalid-mana-regen.json"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /vitals\.mana\.current/);
});

test("hazard artifact V3 rejects invalid durability regen shape", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const result = validateHazardArtifact(readFixture("invalid/hazard-artifact-v3-invalid-durability-regen.json"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /vitals\.durability\.regen/);
});

test("hazard artifact V3 rejects legacy top-level vital fields", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = {
    ...readFixture("hazard-artifact-v3-basic.json"),
    mana: { kind: "one-time", amount: 1 },
  };
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /use vitals\.mana/);
});

test("hazard artifact validation rejects unsupported hazard artifact schema", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const result = validateHazardArtifact(readFixture("invalid/hazard-artifact-v1-public.json"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schema: expected agent-kernel\/HazardArtifact/);
});

test("HAZARD_VITAL_KEYS exports canonical hazard vitals", async () => {
  const { HAZARD_VITAL_KEYS } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  assert.ok(Array.isArray(HAZARD_VITAL_KEYS), "HAZARD_VITAL_KEYS must be an array");
  assert.ok(HAZARD_VITAL_KEYS.includes("mana"), "must include mana");
  assert.ok(HAZARD_VITAL_KEYS.includes("durability"), "must include durability");
  assert.ok(!HAZARD_VITAL_KEYS.includes("health"), "must not include health");
  assert.ok(!HAZARD_VITAL_KEYS.includes("stamina"), "must not include stamina");
});

test("ROOM_TILE_VITAL_KEYS exports durability only", async () => {
  const { ROOM_TILE_VITAL_KEYS } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  assert.ok(Array.isArray(ROOM_TILE_VITAL_KEYS), "ROOM_TILE_VITAL_KEYS must be an array");
  assert.ok(ROOM_TILE_VITAL_KEYS.includes("durability"), "must include durability");
  assert.ok(!ROOM_TILE_VITAL_KEYS.includes("health"), "must not include health");
  assert.ok(!ROOM_TILE_VITAL_KEYS.includes("mana"), "must not include mana");
  assert.ok(!ROOM_TILE_VITAL_KEYS.includes("stamina"), "must not include stamina");
});

test("hazard artifact V2 rejects missing mana field", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const result = validateHazardArtifact({
    schema: "agent-kernel/HazardArtifact",
    schemaVersion: 2,
    meta: BASE_META,
    affinity: "fire",
    expression: "emit",
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /mana/);
});

test("hazard artifact V2 accepts one-time mana", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const result = validateHazardArtifact({
    schema: "agent-kernel/HazardArtifact",
    schemaVersion: 2,
    meta: BASE_META,
    affinity: "fire",
    expression: "emit",
    mana: { kind: "one-time", amount: 2 },
  });
  assert.equal(result.ok, true, `Expected ok:true, got errors: ${result.errors.join("; ")}`);
});

test("hazard artifact V2 rejects invalid affinity kind", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const result = validateHazardArtifact({
    schema: "agent-kernel/HazardArtifact",
    schemaVersion: 2,
    meta: BASE_META,
    affinity: "thunder",
    expression: "emit",
    mana: { kind: "regen", current: 4, max: 4, regen: 1 },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /affinity/);
});

test("hazard artifact V2 accepts draw expression", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const result = validateHazardArtifact({
    schema: "agent-kernel/HazardArtifact",
    schemaVersion: 2,
    meta: BASE_META,
    affinity: "water",
    expression: "draw",
    mana: { kind: "regen", current: 4, max: 4, regen: 1 },
  });
  assert.equal(result.ok, true, `Expected ok:true, got errors: ${result.errors.join("; ")}`);
});

test("hazard and room tile vital key exports expose expected contract lengths", async () => {
  const { HAZARD_VITAL_KEYS, ROOM_TILE_VITAL_KEYS } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  assert.equal(HAZARD_VITAL_KEYS.length, 2);
  assert.equal(ROOM_TILE_VITAL_KEYS.length, 1);
});

// ## TODO: Test Permutations
// - hazard V3 with affinityStacks missing targetType should remain valid.
// - hazard V3 with top-level affinity/expression disagreeing with affinityStacks[0] should report a contract drift decision.
// - hazard V1 and V2 compatibility fixtures should stay valid after future V3 additions.
