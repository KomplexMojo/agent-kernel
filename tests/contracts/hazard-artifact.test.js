const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl } = require("../helpers/esm-runner");

async function loadValidator() {
  return import(moduleUrl("packages/runtime/src/contracts/build-spec.js"));
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

test("hazard artifact validation rejects unknown schemaVersion", async () => {
  const { validateHazardArtifact } = await loadValidator();
  const artifact = readFixture("invalid/hazard-artifact-v2.json");
  const result = validateHazardArtifact(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schemaVersion/);
});
