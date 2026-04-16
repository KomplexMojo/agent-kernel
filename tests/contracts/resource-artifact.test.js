const test = require("node:test");
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

test("resource artifacts accept valid fixtures", () => {
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

test("resource artifacts reject missing vitals field", () => {
  const fixture = readFixture("invalid/resource-artifact-v1-missing-tier.json");
  assert.throws(() => validateResourceArtifact(fixture));
});

test("resource artifacts reject invalid vital key", () => {
  const fixture = readFixture("invalid/resource-artifact-v1-invalid-tier.json");
  assert.throws(() => validateResourceArtifact(fixture));
});

test("resource artifacts reject empty vitals array", () => {
  const fixture = readFixture("invalid/resource-artifact-v1-missing-stat.json");
  assert.throws(() => validateResourceArtifact(fixture));
});
