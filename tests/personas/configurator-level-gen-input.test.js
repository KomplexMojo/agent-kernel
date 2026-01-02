const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/level-gen.js");
const missingWidthFixture = readFixture("invalid/configurator-level-gen-v1-missing-width.json");
const outOfRangeFixture = readFixture("invalid/configurator-level-gen-v1-out-of-range.json");

test("normalizeLevelGenInput applies defaults for optional fields", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(modulePath)};

const result = normalizeLevelGenInput({ width: 5, height: 4 });
assert.equal(result.ok, true);
assert.deepEqual(result.warnings, []);
assert.equal(result.value.shape.profile, "rectangular");
assert.equal(result.value.spawn.edgeBias, false);
assert.equal(result.value.spawn.minDistance, 0);
assert.equal(result.value.exit.edgeBias, false);
assert.equal(result.value.exit.minDistance, 0);
assert.equal(result.value.connectivity.requirePath, true);
assert.equal(result.value.seed, undefined);
assert.equal(result.value.theme, undefined);
`;
  runEsm(script);
});

test("normalizeLevelGenInput clamps out-of-range values", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(outOfRangeFixture)};
const result = normalizeLevelGenInput(fixture);
assert.equal(result.ok, true);
assert.equal(result.value.shape.density, 1);
assert.equal(result.value.spawn.minDistance, 4);
assert.equal(result.value.exit.minDistance, 0);
assert.equal(result.warnings.length, 3);
`;
  runEsm(script);
});

test("normalizeLevelGenInput rejects invalid sizes and profiles", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(modulePath)};

const result = normalizeLevelGenInput({
  width: 0,
  height: 2,
  shape: { profile: "unknown" },
});
assert.equal(result.ok, false);
assert.equal(result.value, null);
assert.ok(result.errors.find((e) => e.field === "width"));
assert.ok(result.errors.find((e) => e.field === "shape.profile"));
`;
  runEsm(script);
});

test("normalizeLevelGenInput rejects missing required fields", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(missingWidthFixture)};
const result = normalizeLevelGenInput(fixture);
assert.equal(result.ok, false);
assert.equal(result.value, null);
assert.ok(result.errors.find((e) => e.field === "width"));
`;
  runEsm(script);
});
