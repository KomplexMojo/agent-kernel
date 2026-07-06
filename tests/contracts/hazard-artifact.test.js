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

// --- V2 contract: hazards have mana only, durability removed ---

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

test("HAZARD_VITAL_KEYS exports mana only", async () => {
  const { HAZARD_VITAL_KEYS } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  assert.ok(Array.isArray(HAZARD_VITAL_KEYS), "HAZARD_VITAL_KEYS must be an array");
  assert.ok(HAZARD_VITAL_KEYS.includes("mana"), "must include mana");
  assert.ok(!HAZARD_VITAL_KEYS.includes("durability"), "must not include durability");
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

test("hazard and room tile vital key exports are singleton lists", async () => {
  const { HAZARD_VITAL_KEYS, ROOM_TILE_VITAL_KEYS } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  assert.equal(HAZARD_VITAL_KEYS.length, 1);
  assert.equal(ROOM_TILE_VITAL_KEYS.length, 1);
});
