const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl } = require("../helpers/esm-runner");

async function loadValidator() {
  return import(moduleUrl("packages/runtime/src/contracts/build-spec.js"));
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
