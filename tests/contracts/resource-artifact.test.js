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

test("resource artifact V3 rejects empty vitals array", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const result = validate({
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: [],
    permanenceMode: "consumable",
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /vitals/);
});

test("resource artifact V3 rejects invalid vital key", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const result = validate({
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: [{ key: "durability", delta: 1 }],
    permanenceMode: "consumable",
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /vitals\[0\]\.key/);
});

test("resource artifact V3 rejects missing permanenceMode", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const result = validate({
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: BASE_VITALS,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /permanenceMode/);
});

test("resource artifact V3 accepts consumable mana vital delta", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: [{ key: "mana", delta: 2 }],
    permanenceMode: "consumable",
  };
  const result = validate(artifact);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
  assert.deepEqual(artifact.vitals, [{ key: "mana", delta: 2 }]);
});

test("resource artifact V3 permanent mode is distinct from V2 permanent boolean", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const v3 = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 3,
    meta: BASE_META,
    vitals: BASE_VITALS,
    permanenceMode: "permanent",
  };
  const v2 = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 2,
    meta: BASE_META,
    vitals: BASE_VITALS,
    permanent: true,
  };
  assert.equal(validate(v3).ok, true);
  assert.equal(validate(v2).ok, true);
  assert.equal("permanenceMode" in v3, true);
  assert.equal("permanent" in v3, false);
  assert.equal("permanent" in v2, true);
  assert.equal("permanenceMode" in v2, false);
});

test("resource artifact V2 permanent fixture remains valid", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const artifact = readFixture("resource-artifact-v1-rare-regen.json");
  const result = validate(artifact);
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.permanent, true);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
});

test("resource artifact V1 tier/stat fixture remains valid", async () => {
  const { validateResourceArtifact: validate } = await loadValidator();
  const artifact = {
    schema: "agent-kernel/ResourceArtifact",
    schemaVersion: 1,
    meta: BASE_META,
    tier: "level",
    stat: "vitalMax",
    delta: 1,
    dropRate: 1,
  };
  const result = validate(artifact);
  assert.equal(result.ok, true, `Expected ok:true, got: ${result.errors.join("; ")}`);
});
