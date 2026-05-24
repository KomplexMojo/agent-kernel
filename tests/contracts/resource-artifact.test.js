const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const VALID_VITAL_KEYS = new Set(["health", "mana", "stamina"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateResourceArtifact(artifact) {
  assert.ok(isObject(artifact));
  assert.equal(artifact.schema, "agent-kernel/ResourceArtifact");
  assert.equal(artifact.schemaVersion, 2);
  assert.ok(isObject(artifact.meta));
  assert.equal(typeof artifact.meta.id, "string");
  assert.equal(typeof artifact.meta.runId, "string");
  assert.equal(typeof artifact.meta.createdAt, "string");
  assert.equal(typeof artifact.meta.producedBy, "string");

  assert.ok(Array.isArray(artifact.vitals) && artifact.vitals.length > 0, "vitals must be a non-empty array");
  for (const v of artifact.vitals) {
    assert.ok(VALID_VITAL_KEYS.has(v.key), `invalid vital key: ${v.key}`);
    assert.equal(typeof v.delta, "number");
    if (v.regen !== undefined) assert.equal(typeof v.regen, "number");
  }
  assert.equal(typeof artifact.permanent, "boolean");
}

test("resource artifacts accept valid fixtures", async () => {
  const commonHealth = readFixture("resource-artifact-v1-common-health.json");
  const rareRegen = readFixture("resource-artifact-v1-rare-regen.json");
  const rareAffinity = readFixture("resource-artifact-v1-rare-affinity.json");

  validateResourceArtifact(commonHealth);
  validateResourceArtifact(rareRegen);
  validateResourceArtifact(rareAffinity);

  assert.equal(commonHealth.permanent, false);
  assert.equal(rareRegen.permanent, true);
  assert.equal(rareAffinity.permanent, true);
});

test("resource artifacts reject missing vitals field", async () => {
  const fixture = readFixture("invalid/resource-artifact-v1-missing-tier.json");
  assert.throws(() => validateResourceArtifact(fixture));
});

test("resource artifacts reject invalid vital key", async () => {
  const fixture = readFixture("invalid/resource-artifact-v1-invalid-tier.json");
  assert.throws(() => validateResourceArtifact(fixture));
});

test("resource artifacts reject empty vitals array", async () => {
  const fixture = readFixture("invalid/resource-artifact-v1-missing-stat.json");
  assert.throws(() => validateResourceArtifact(fixture));
});

// --- V3 contract: three permanence modes ---


async function loadValidator() {
  return import("../../packages/runtime/src/contracts/build-spec.js");
}

const BASE_META = {
  id: "r1",
  runId: "run1",
  createdAt: "2026-01-01T00:00:00.000Z",
  producedBy: "test",
};

const BASE_VITALS = [{ key: "health", delta: 10 }];

test("resource artifact V3 accepts permanenceMode 'consumable'", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: BASE_VITALS,
    permanenceMode: "consumable",
  };
  const result = validate(artifact);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
});

test("resource artifact V3 accepts permanenceMode 'level'", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: BASE_VITALS,
    permanenceMode: "level",
  };
  const result = validate(artifact);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
});

test("resource artifact V3 accepts permanenceMode 'permanent'", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: BASE_VITALS,
    permanenceMode: "permanent",
  };
  const result = validate(artifact);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
});

test("resource artifact V3 rejects unknown permanenceMode", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: BASE_VITALS,
    permanenceMode: "temporary",
  };
  const result = validate(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /permanenceMode/);
});

test("RESOURCE_PERMANENCE_MODES exports all three modes", async () => {
  const { RESOURCE_PERMANENCE_MODES } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  assert.ok(Array.isArray(RESOURCE_PERMANENCE_MODES), "must be an array");
  assert.ok(RESOURCE_PERMANENCE_MODES.includes("consumable"));
  assert.ok(RESOURCE_PERMANENCE_MODES.includes("level"));
  assert.ok(RESOURCE_PERMANENCE_MODES.includes("permanent"));
});

/*
## TODO: Test Permutations
- resource V3 with empty vitals array should be invalid
- resource V3 with invalid vital key (e.g. "durability") should be invalid
- resource V3 with missing permanenceMode should be invalid
- resource V3 with mana vital + permanenceMode="consumable" should apply only current stat delta
- resource V3 with permanenceMode="permanent" should be distinguishable from V2 permanent:true
- resource V2 backward-compat: existing permanent:true fixture still validates as V2
- resource V1 backward-compat: existing tier/stat/delta/dropRate fixture still validates as V1
*/
