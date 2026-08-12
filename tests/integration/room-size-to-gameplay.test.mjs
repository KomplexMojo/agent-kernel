import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildSummaryFromCardSet,
  createDesignCard,
} from "../../packages/ui-web/src/design-guidance.js";
import { buildBuildSpecFromSummary } from "../../packages/runtime/src/personas/director/buildspec-assembler.js";
import { orchestrateBuild } from "../../packages/runtime/src/build/orchestrate-build.js";

// These tests lock the room-size → gameplay-layout contract end to end. They
// exercise the exact functions the Phaser design surface uses (buildSummaryFromCardSet
// is what the card-builder controller's publishSpecText() calls), then push the
// resulting summary through the same director + build orchestration the gameplay
// tab triggers. A regression here is what made "room size has no effect in gameplay".

const DEFAULT_GRID_SIDE = 5; // the no-room fallback grid is 5x5

function summaryForRoom(size) {
  const { summary } = buildSummaryFromCardSet({
    budgetTokens: 2500,
    cards: [createDesignCard({ id: `room_${size}`, type: "room", roomSize: size, affinity: "fire", count: 1 })],
  });
  return summary;
}

async function layoutForRoom(size) {
  const summary = summaryForRoom(size);
  const built = buildBuildSpecFromSummary({
    summary,
    runId: `run_room_${size}`,
    createdAt: "2025-01-01T00:00:00Z",
    source: "room-size-test",
  });
  assert.equal(built.ok, true, `build spec failed for ${size}: ${JSON.stringify(built.errors)}`);
  const result = await orchestrateBuild({ spec: built.spec, producedBy: "room-size-test" });
  const data = result?.simConfig?.layout?.data;
  assert.ok(data, `no layout data produced for ${size}`);
  return data;
}

test("buildSummaryFromCardSet emits a card-derived levelGen that scales with room size", () => {
  const small = summaryForRoom("small");
  const medium = summaryForRoom("medium");
  const large = summaryForRoom("large");

  for (const [size, summary] of [["small", small], ["medium", medium], ["large", large]]) {
    assert.ok(summary.levelGen, `${size} summary is missing levelGen`);
    assert.ok(summary.levelGen.width > DEFAULT_GRID_SIDE, `${size} levelGen.width must exceed the ${DEFAULT_GRID_SIDE}x default`);
    // walkableTilesTarget forces an exact tile count the room generator cannot
    // always hit, which previously made the build reject and fall back to 5x5.
    assert.equal(
      summary.levelGen.walkableTilesTarget,
      undefined,
      `${size} levelGen must not carry walkableTilesTarget`,
    );
  }

  assert.ok(small.levelGen.width < large.levelGen.width, "large room must yield a wider grid than small");
  assert.ok(small.levelGen.width <= medium.levelGen.width, "medium room must be at least as wide as small");
  assert.ok(medium.levelGen.width <= large.levelGen.width, "large room must be at least as wide as medium");
});

test("a large room produces a substantially larger gameplay layout than the default", async () => {
  const large = await layoutForRoom("large");
  assert.ok(large.width >= 14, `large room layout width ${large.width} should be >= 14, not the ${DEFAULT_GRID_SIDE}x default`);
  assert.ok(large.height >= 14, `large room layout height ${large.height} should be >= 14`);

  const room = Array.isArray(large.rooms) ? large.rooms[0] : null;
  assert.ok(room, "large layout must contain at least one room");
  assert.ok(room.width >= 8 && room.height >= 8, `large room footprint ${room.width}x${room.height} should be >= 8x8`);
});

test("gameplay layout grows monotonically with room size", async () => {
  const small = await layoutForRoom("small");
  const large = await layoutForRoom("large");
  const smallTiles = small.width * small.height;
  const largeTiles = large.width * large.height;
  assert.ok(
    largeTiles > smallTiles,
    `large layout (${large.width}x${large.height}) must have more tiles than small (${small.width}x${small.height})`,
  );
});

test("a design with no room cards still falls back to the default grid", async () => {
  const { summary } = buildSummaryFromCardSet({
    budgetTokens: 2500,
    cards: [createDesignCard({ id: "delver_only", type: "delver", affinity: "light", motivations: ["attacking"] })],
  });
  assert.equal(summary.levelGen, undefined, "a room-less design must not synthesize a card-derived levelGen");

  const built = buildBuildSpecFromSummary({
    summary,
    runId: "run_no_rooms",
    createdAt: "2025-01-01T00:00:00Z",
    source: "room-size-test",
  });
  assert.equal(built.ok, true, `build spec failed: ${JSON.stringify(built.errors)}`);
  assert.equal(built.spec.configurator.inputs.levelGen.width, DEFAULT_GRID_SIDE);
  assert.equal(built.spec.configurator.inputs.levelGen.height, DEFAULT_GRID_SIDE);
});
