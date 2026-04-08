const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const builderModule = moduleUrl("packages/runtime/src/personas/configurator/guidance-level-builder.js");

test("guidance level builder derives deterministic level previews from guidance summaries", () => {
  const script = `
import assert from "node:assert/strict";
import {
  deriveLevelGenFromGuidanceSummary,
  buildLevelPreviewFromGuidanceSummary,
  buildLevelPreviewFromLevelGen,
  buildLevelRenderArtifactsFromTiles,
} from ${JSON.stringify(builderModule)};

  const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 1200,
  layout: { floorTiles: 120, connectorFloorTiles: 30, billableFloorTiles: 90 },
  roomDesign: {
    corridorWidth: 2,
    rooms: [{ id: "R1", size: "medium", width: 10, height: 8 }],
    connections: [],
    hallways: "single",
  },
  actors: [],
  rooms: [],
};

const levelGen = deriveLevelGenFromGuidanceSummary(summary);
assert.ok(levelGen && typeof levelGen === "object");
assert.equal(levelGen.walkableTilesTarget, 120);

const preview = buildLevelPreviewFromGuidanceSummary(summary);
assert.equal(preview.ok, true);
assert.equal(preview.walkableTiles, 120);
assert.ok(Array.isArray(preview.tiles));
assert.ok(preview.width > 0);
assert.ok(preview.height > 0);
assert.ok(preview.ascii && typeof preview.ascii.text === "string");
assert.ok(Array.isArray(preview.ascii.lines));
assert.ok(preview.image && preview.image.pixels instanceof Uint8ClampedArray);
assert.equal(preview.image.pixelFormat, "rgba8");
assert.equal(preview.image.pixels.length, preview.width * preview.height * 4);

const fromLevelGen = buildLevelPreviewFromLevelGen(levelGen);
assert.equal(fromLevelGen.ok, true);
assert.equal(fromLevelGen.walkableTiles, 120);

const fromTiles = buildLevelRenderArtifactsFromTiles(["S.E", ".#."], { includeAscii: true, includeImage: true });
assert.equal(fromTiles.ok, true);
assert.equal(fromTiles.width, 3);
assert.equal(fromTiles.height, 2);
assert.equal(fromTiles.walkableTiles, 5);
assert.ok(fromTiles.image && fromTiles.image.pixels instanceof Uint8ClampedArray);
assert.equal(fromTiles.image.pixelFormat, "rgba8");

const fromAffinityTiles = buildLevelRenderArtifactsFromTiles(["..."], {
  includeAscii: true,
  includeImage: true,
  floorAffinityTraps: [
    { x: 0, y: 0, affinity: { kind: "fire", expression: "emit", targetType: "floor", stacks: 1 } },
    { x: 1, y: 0, affinity: { kind: "fire", expression: "emit", targetType: "floor", stacks: 1, roomStacks: 3 } },
  ],
});
assert.equal(fromAffinityTiles.ok, true);
// With spreading: trap at [1,0] has roomStacks:3 which spreads to neighbors [0,0] and [2,0] with stacks:2
// [0,0]: direct stacks 1 is overridden by spread stacks 2 → 'F'
// [1,0]: direct stacks 3 (from roomStacks) → 'F'
// [2,0]: spread stacks 2 → 'F'
assert.equal(fromAffinityTiles.ascii.lines[0][0], "F");
assert.equal(fromAffinityTiles.ascii.lines[0][1], "F");
assert.equal(fromAffinityTiles.ascii.lines[0][2], "F");
const lowStackPixel = Array.from(fromAffinityTiles.image.pixels.slice(0, 4));
const highStackPixel = Array.from(fromAffinityTiles.image.pixels.slice(4, 8));
assert.notDeepEqual(lowStackPixel, highStackPixel);

const invalidPreview = buildLevelPreviewFromGuidanceSummary(null);
assert.equal(invalidPreview.ok, false);
assert.equal(invalidPreview.reason, "missing_summary");

const highBudgetShapes = [
  { roomCount: 18, roomMinSize: 4, roomMaxSize: 12, corridorWidth: 2 },
  { roomCount: 24, roomMinSize: 3, roomMaxSize: 8, corridorWidth: 1 },
];

highBudgetShapes.forEach((shape, index) => {
  const highBudgetPreview = buildLevelPreviewFromGuidanceSummary({
    dungeonAffinity: "water",
    budgetTokens: 10000,
    layout: { floorTiles: 5500, connectorFloorTiles: 0, billableFloorTiles: 5500 },
    roomDesign: shape,
    actors: [],
    rooms: [],
  }, {
    includeAscii: false,
    includeImage: false,
  });
  assert.equal(highBudgetPreview.ok, true, "shape index " + index);
  assert.equal(highBudgetPreview.walkableTiles, 5500, "shape index " + index);
});

`;

  runEsm(script);
});

test("mixed-affinity floor resolution is invariant to trap ordering (permutation test)", () => {
  const script = `
import assert from "node:assert/strict";
import {
  buildLevelRenderArtifactsFromTiles,
} from ${JSON.stringify(builderModule)};

// Three traps at the same cell (1,0) with equal stacks but different affinities.
// The tie-break rule uses AFFINITY_RENDER_ORDER index, so "fire" (index 0) should
// always win over "water" (index 1) and "earth" (index 2) when stacks are equal.
const baseTrap = (kind) => ({
  x: 1, y: 0,
  affinity: { kind, expression: "emit", targetType: "floor", stacks: 2 },
});

const trapSets = [
  [baseTrap("fire"), baseTrap("water"), baseTrap("earth")],
  [baseTrap("water"), baseTrap("fire"), baseTrap("earth")],
  [baseTrap("earth"), baseTrap("water"), baseTrap("fire")],
  [baseTrap("earth"), baseTrap("fire"), baseTrap("water")],
  [baseTrap("water"), baseTrap("earth"), baseTrap("fire")],
  [baseTrap("fire"), baseTrap("earth"), baseTrap("water")],
];

const tiles = ["..."];
let referenceAscii = null;
let referencePixels = null;

trapSets.forEach((traps, permIndex) => {
  const result = buildLevelRenderArtifactsFromTiles(tiles, {
    includeAscii: true,
    includeImage: true,
    floorAffinityTraps: traps,
  });
  assert.equal(result.ok, true, "permutation " + permIndex + " should succeed");

  // Cell (1,0) should resolve to "fire" (lowest AFFINITY_RENDER_ORDER index at equal stacks)
  // ASCII glyph for fire at stacks>=2 is uppercase "F"
  assert.equal(result.ascii.lines[0][1], "F",
    "permutation " + permIndex + ": cell (1,0) should be fire uppercase glyph");

  const cellPixelOffset = 1 * 4; // cell (1,0) -> pixel index 1
  const pixel = Array.from(result.image.pixels.slice(cellPixelOffset, cellPixelOffset + 4));

  if (permIndex === 0) {
    referenceAscii = result.ascii.lines[0];
    referencePixels = pixel;
  } else {
    assert.equal(result.ascii.lines[0], referenceAscii,
      "permutation " + permIndex + ": ASCII row must match reference");
    assert.deepStrictEqual(pixel, referencePixels,
      "permutation " + permIndex + ": pixel RGBA must match reference");
  }
});

// Also verify a second cell with different stacks to ensure higher-stacks still wins
// regardless of ordering. Place a stacks=3 water trap and a stacks=2 fire trap at (0,0).
const mixedStackTraps = [
  [
    { x: 0, y: 0, affinity: { kind: "fire", expression: "emit", targetType: "floor", stacks: 2 } },
    { x: 0, y: 0, affinity: { kind: "water", expression: "emit", targetType: "floor", stacks: 3 } },
  ],
  [
    { x: 0, y: 0, affinity: { kind: "water", expression: "emit", targetType: "floor", stacks: 3 } },
    { x: 0, y: 0, affinity: { kind: "fire", expression: "emit", targetType: "floor", stacks: 2 } },
  ],
];

let refStackAscii = null;
let refStackPixel = null;

mixedStackTraps.forEach((traps, permIndex) => {
  const result = buildLevelRenderArtifactsFromTiles(tiles, {
    includeAscii: true,
    includeImage: true,
    floorAffinityTraps: traps,
  });
  assert.equal(result.ok, true);
  // Water at stacks=3 should win (higher stacks). Uppercase "W"
  assert.equal(result.ascii.lines[0][0], "W",
    "mixed-stacks perm " + permIndex + ": higher-stacks water should win");

  const pixel = Array.from(result.image.pixels.slice(0, 4));
  if (permIndex === 0) {
    refStackAscii = result.ascii.lines[0][0];
    refStackPixel = pixel;
  } else {
    assert.equal(result.ascii.lines[0][0], refStackAscii,
      "mixed-stacks perm " + permIndex + ": ASCII must match");
    assert.deepStrictEqual(pixel, refStackPixel,
      "mixed-stacks perm " + permIndex + ": pixel must match");
  }
});
`;

  runEsm(script);
});

test("guidance level builder maps room cards into level generation inputs", () => {
  const script = `
import assert from "node:assert/strict";
import {
  deriveLevelGenFromCardSet,
  deriveLevelGenFromGuidanceSummary,
  buildLevelPreviewFromGuidanceSummary,
} from ${JSON.stringify(builderModule)};

const cardSet = [
  { id: "room_small", type: "room", affinity: "fire", roomSize: "small", count: 2 },
  { id: "room_large", type: "room", affinity: "water", roomSize: "large", count: 1 },
];

const levelGen = deriveLevelGenFromCardSet(cardSet);
assert.ok(levelGen);
assert.equal(levelGen.shape.roomCount, 3);
assert.ok(levelGen.walkableTilesTarget > 0);

const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 1800,
  cardSet,
};
const summaryLevelGen = deriveLevelGenFromGuidanceSummary(summary);
assert.ok(summaryLevelGen);
assert.equal(summaryLevelGen.shape.roomCount, 3);

const preview = buildLevelPreviewFromGuidanceSummary(summary, { includeAscii: false, includeImage: false });
assert.equal(preview.ok, true);
assert.ok(preview.walkableTiles > 0);
`;

  runEsm(script);
});
