const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture, listFixtures } = require("../helpers/fixtures");

function roundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

test("artifact fixtures round-trip serialize", () => {
  const files = listFixtures().filter((name) => name.endsWith(".json"));
  for (const name of files) {
    const fixture = readFixture(name);
    const copy = roundTrip(fixture);
    assert.deepEqual(copy, fixture, `Round-trip mismatch for ${name}`);
    if (fixture.schema) {
      assert.equal(fixture.schemaVersion, 1, `Expected schemaVersion 1 for ${name}`);
    }
  }
});
