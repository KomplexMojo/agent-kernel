// #377: MotivationRules v2 drops globals.defaultIntensity/maxIntensity; a v1 artifact still
// loads with them ignored.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../../..");
const readFixture = (path) => JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts", path), "utf8"));

test("a v1 artifact loads and its intensity globals are ignored", async () => {
  const { DEFAULT_MOTIVATION_RULES_ARTIFACT, normalizeMotivationRulesArtifact } = await import("../../../packages/runtime/src/personas/configurator/motivation-rules.js");
  const v1 = JSON.parse(JSON.stringify(DEFAULT_MOTIVATION_RULES_ARTIFACT));
  v1.schemaVersion = 1;
  v1.globals = { defaultIntensity: 1, maxIntensity: 10, ...v1.globals };
  const result = normalizeMotivationRulesArtifact(v1);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.value.schemaVersion, 1);
  assert.deepEqual(Object.keys(result.value.globals), ["reasoningClasses"]);
});

test("the default artifact is v2 and carries no intensity globals", async () => {
  const { DEFAULT_MOTIVATION_RULES_ARTIFACT, normalizeMotivationRulesArtifact } = await import("../../../packages/runtime/src/personas/configurator/motivation-rules.js");
  assert.equal(DEFAULT_MOTIVATION_RULES_ARTIFACT.schemaVersion, 2);
  assert.equal("defaultIntensity" in DEFAULT_MOTIVATION_RULES_ARTIFACT.globals, false);
  assert.equal(normalizeMotivationRulesArtifact(DEFAULT_MOTIVATION_RULES_ARTIFACT).ok, true);
});

test("an unknown schemaVersion is refused", async () => {
  const { normalizeMotivationRulesArtifact } = await import("../../../packages/runtime/src/personas/configurator/motivation-rules.js");
  const result = normalizeMotivationRulesArtifact(readFixture("invalid/motivation-rules-artifact-v3.json"));
  assert.equal(result.ok, false);
});
