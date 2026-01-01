const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const FIXTURE_ROOT = resolve(ROOT, "tests/fixtures");

const FIXTURE_NAMES = [
  "actor-placement-v1-out-of-bounds.json",
  "actor-placement-v1-spawn-mismatch.json",
  "actor-placement-v1-spawn-barrier.json",
  "actor-placement-v1-overlap.json",
];

const EXPECTED_ERRORS = new Set([
  "actor_out_of_bounds",
  "actor_spawn_mismatch",
  "actor_blocked",
  "actor_collision",
]);

function readPlacementFixture(name) {
  return JSON.parse(readFileSync(resolve(FIXTURE_ROOT, name), "utf8"));
}

test("actor placement fixtures declare schema and expected errors", () => {
  for (const name of FIXTURE_NAMES) {
    const fixture = readPlacementFixture(name);
    assert.equal(fixture.schema, "agent-kernel/ActorPlacementFixture");
    assert.equal(fixture.schemaVersion, 1);
    assert.ok(EXPECTED_ERRORS.has(fixture.expectedError), `${name} uses expected error`);
    assert.ok(Array.isArray(fixture.placements), `${name} includes placements array`);
    for (const placement of fixture.placements) {
      assert.equal(typeof placement.id, "number", `${name} placement id is numeric`);
      assert.equal(typeof placement.x, "number", `${name} placement x is numeric`);
      assert.equal(typeof placement.y, "number", `${name} placement y is numeric`);
    }
    if (fixture.spawn) {
      assert.equal(typeof fixture.spawn.x, "number", `${name} spawn x is numeric`);
      assert.equal(typeof fixture.spawn.y, "number", `${name} spawn y is numeric`);
    }
  }
});
