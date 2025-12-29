const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

function assertMissingField(fixtureName, field) {
  const data = readFixture(`invalid/${fixtureName}`);
  assert.equal(data[field], undefined, `${fixtureName} should be missing ${field}`);
}

test("invalid fixtures omit required fields", () => {
  assertMissingField("intent-envelope-v1-missing-meta.json", "meta");
  assertMissingField("plan-artifact-v1-missing-plan.json", "plan");
  assertMissingField("sim-config-artifact-v1-missing-layout.json", "layout");
  assertMissingField("initial-state-artifact-v1-missing-actors.json", "actors");
  assertMissingField("solver-request-v1-missing-problem.json", "problem");
  assertMissingField("solver-result-v1-missing-request-ref.json", "requestRef");
  assertMissingField("tick-frame-v1-missing-phase.json", "phase");
});
