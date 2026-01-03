const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateRef(ref) {
  assert.ok(isObject(ref));
  assert.equal(typeof ref.id, "string");
  assert.equal(typeof ref.schema, "string");
  assert.equal(Number.isInteger(ref.schemaVersion), true);
}

function validateCapturedInput(artifact) {
  assert.ok(isObject(artifact));
  assert.equal(artifact.schema, "agent-kernel/CapturedInputArtifact");
  assert.equal(artifact.schemaVersion, 1);
  assert.ok(isObject(artifact.meta));
  assert.ok(isObject(artifact.source));
  assert.equal(typeof artifact.source.adapter, "string");
  assert.equal(typeof artifact.contentType, "string");

  const hasPayload = "payload" in artifact;
  const hasPayloadRef = "payloadRef" in artifact;
  assert.equal(hasPayload || hasPayloadRef, true);

  if (hasPayloadRef) {
    assert.ok(isObject(artifact.payloadRef));
    if (artifact.payloadRef.path !== undefined) {
      assert.equal(typeof artifact.payloadRef.path, "string");
    }
    if (artifact.payloadRef.artifactRef !== undefined) {
      validateRef(artifact.payloadRef.artifactRef);
    }
    assert.equal(
      artifact.payloadRef.path !== undefined || artifact.payloadRef.artifactRef !== undefined,
      true,
    );
  }
}

test("captured input artifacts accept valid shapes", () => {
  const jsonCapture = readFixture("captured-input-artifact-v1-json.json");
  const refCapture = readFixture("captured-input-artifact-v1-ref.json");

  validateCapturedInput(jsonCapture);
  validateCapturedInput(refCapture);
});

test("captured input artifacts reject missing source or payload", () => {
  const missingSource = readFixture("invalid/captured-input-artifact-v1-missing-source.json");
  const missingPayload = readFixture("invalid/captured-input-artifact-v1-missing-payload.json");

  assert.throws(() => validateCapturedInput(missingSource));
  assert.throws(() => validateCapturedInput(missingPayload));
});
