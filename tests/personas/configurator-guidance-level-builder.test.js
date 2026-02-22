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
  layout: { floorTiles: 120, hallwayTiles: 30 },
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
assert.equal(levelGen.walkableTilesTarget, 150);

const preview = buildLevelPreviewFromGuidanceSummary(summary);
assert.equal(preview.ok, true);
assert.equal(preview.walkableTiles, 150);
assert.ok(Array.isArray(preview.tiles));
assert.ok(preview.width > 0);
assert.ok(preview.height > 0);
assert.ok(preview.ascii && typeof preview.ascii.text === "string");
assert.ok(Array.isArray(preview.ascii.lines));
assert.ok(preview.image && preview.image.pixels instanceof Uint8ClampedArray);
assert.equal(preview.image.pixels.length, preview.width * preview.height * 4);

const fromLevelGen = buildLevelPreviewFromLevelGen(levelGen);
assert.equal(fromLevelGen.ok, true);
assert.equal(fromLevelGen.walkableTiles, 150);

const fromTiles = buildLevelRenderArtifactsFromTiles(["S.E", ".#."], { includeAscii: true, includeImage: true });
assert.equal(fromTiles.ok, true);
assert.equal(fromTiles.width, 3);
assert.equal(fromTiles.height, 2);
assert.equal(fromTiles.walkableTiles, 5);
assert.ok(fromTiles.image && fromTiles.image.pixels instanceof Uint8ClampedArray);

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
    layout: { floorTiles: 5500, hallwayTiles: 0 },
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
