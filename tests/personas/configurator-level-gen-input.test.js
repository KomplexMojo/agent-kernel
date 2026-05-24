const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const missingWidthFixture = readFixture("invalid/configurator-level-gen-v1-missing-width.json");

test("normalizeLevelGenInput applies room/hallway defaults for optional fields", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const result = normalizeLevelGenInput({ width: 5, height: 4 });
assert.equal(result.ok, true);
assert.deepEqual(result.warnings, []);
assert.equal(result.value.shape.roomCount, 4);
assert.equal(result.value.shape.roomMinSize, 3);
assert.equal(result.value.shape.roomMaxSize, 9);
assert.equal(result.value.shape.corridorWidth, 1);
assert.equal(result.value.shape.pattern, "none");
assert.equal("patternSpacing" in result.value.shape, false);
assert.equal("patternLineWidth" in result.value.shape, false);
assert.equal("patternGapEvery" in result.value.shape, false);
assert.equal("patternInset" in result.value.shape, false);
assert.equal(result.value.spawn.edgeBias, false);
assert.equal(result.value.spawn.minDistance, 0);
assert.equal(result.value.exit.edgeBias, false);
assert.equal(result.value.exit.minDistance, 0);
assert.equal(result.value.connectivity.requirePath, true);
assert.equal(result.value.seed, undefined);
assert.equal(result.value.theme, undefined);
});

test("normalizeLevelGenInput clamps out-of-range room and distance values", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const result = normalizeLevelGenInput({
  width: 6,
  height: 6,
  shape: {
    roomCount: 999,
    roomMinSize: 0,
    roomMaxSize: 99,
    corridorWidth: 99,
  },
  spawn: { minDistance: 99 },
  exit: { minDistance: -1 },
});
assert.equal(result.ok, true);
assert.equal(result.value.shape.roomCount, 16);
assert.equal(result.value.shape.roomMinSize, 1);
assert.equal(result.value.shape.roomMaxSize, 4);
assert.equal(result.value.shape.corridorWidth, 4);
assert.equal(result.value.spawn.minDistance, 10);
assert.equal(result.value.exit.minDistance, 0);
assert.ok(result.warnings.length >= 4);
});

test("normalizeLevelGenInput rejects invalid sizes", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const result = normalizeLevelGenInput({
  width: 0,
  height: 2,
});
assert.equal(result.ok, false);
assert.equal(result.value, null);
assert.ok(result.errors.find((e) => e.field === "width"));
});

test("normalizeLevelGenInput rejects missing required fields", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const fixture = missingWidthFixture;
const result = normalizeLevelGenInput(fixture);
assert.equal(result.ok, false);
assert.equal(result.value, null);
assert.ok(result.errors.find((e) => e.field === "width"));
});

test("normalizeLevelGenInput rejects walkable target above grid capacity", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const result = normalizeLevelGenInput({
  width: 10,
  height: 10,
  walkableTilesTarget: 1000,
});
assert.equal(result.ok, false);
assert.equal(result.value, null);
assert.ok(result.errors.find((e) => e.field === "walkableTilesTarget"));
});

test("normalizeLevelGenInput does not enforce fixed max side or walkable limits", async () => {const { normalizeLevelGenInput, LEVEL_GEN_LIMITS } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

assert.equal(LEVEL_GEN_LIMITS.maxLevelSide, null);
assert.equal(LEVEL_GEN_LIMITS.maxWalkableTilesTarget, null);

const oversized = normalizeLevelGenInput({
  width: 5000,
  height: 5000,
});
assert.equal(oversized.ok, true);
assert.equal(oversized.value.width, 5000);
assert.equal(oversized.value.height, 5000);

const excessiveWalkable = normalizeLevelGenInput({
  width: 20000,
  height: 20000,
  walkableTilesTarget: 100000000,
});
assert.equal(excessiveWalkable.ok, true);
assert.equal(excessiveWalkable.errors.length, 0);
assert.equal(excessiveWalkable.value.walkableTilesTarget, 100000000);
});

test("normalizeLevelGenInput preserves optional shape corridor settings", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const result = normalizeLevelGenInput({
  width: 64,
  height: 64,
  walkableTilesTarget: 1200,
  shape: { corridorWidth: 3 },
});
assert.equal(result.ok, true);
assert.equal(result.value.shape.corridorWidth, 3);
});

test("normalizeLevelGenInput accepts explicit grid pattern shape settings", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const result = normalizeLevelGenInput({
  width: 64,
  height: 64,
  shape: {
    pattern: "grid",
    patternSpacing: 8,
    patternLineWidth: 2,
    patternGapEvery: 5,
    patternInset: 2,
  },
});
assert.equal(result.ok, true);
assert.equal(result.value.shape.pattern, "grid");
assert.equal(result.value.shape.patternSpacing, 8);
assert.equal(result.value.shape.patternLineWidth, 2);
assert.equal(result.value.shape.patternGapEvery, 5);
assert.equal(result.value.shape.patternInset, 2);
});

test("normalizeLevelGenInput accepts diagonal and concentric hallway patterns", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const diagonal = normalizeLevelGenInput({
  width: 64,
  height: 64,
  shape: {
    pattern: "diagonal_grid",
    patternLineWidth: 2,
    patternInfillPercent: 75,
  },
});
assert.equal(diagonal.ok, true);
assert.equal(diagonal.value.shape.pattern, "diagonal_grid");
assert.equal(diagonal.value.shape.patternLineWidth, 2);
assert.equal(diagonal.value.shape.patternInfillPercent, 75);

const concentric = normalizeLevelGenInput({
  width: 64,
  height: 64,
  shape: {
    pattern: "concentric_circles",
    patternLineWidth: 1,
    patternInfillPercent: 55,
  },
});
assert.equal(concentric.ok, true);
assert.equal(concentric.value.shape.pattern, "concentric_circles");
assert.equal(concentric.value.shape.patternLineWidth, 1);
assert.equal(concentric.value.shape.patternInfillPercent, 55);
});

test("normalizeLevelGenInput validates optional trap target types", async () => {const { normalizeLevelGenInput } = await import("../../packages/runtime/src/personas/configurator/level-gen.js");

const valid = normalizeLevelGenInput({
  width: 8,
  height: 8,
  traps: [
    {
      x: 1,
      y: 1,
      affinity: { kind: "fire", expression: "emit", stacks: 2, targetType: "floor" },
    },
  ],
});
assert.equal(valid.ok, true);
assert.equal(valid.value.traps[0].affinity.targetType, "floor");

const invalid = normalizeLevelGenInput({
  width: 8,
  height: 8,
  traps: [
    {
      x: 1,
      y: 1,
      affinity: { kind: "fire", expression: "emit", stacks: 2, targetType: "ceiling" },
    },
  ],
});
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.find((entry) => entry.code === "invalid_target_type"));
});
