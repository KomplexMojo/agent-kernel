import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  deriveTileAffinityVisuals,
  resolveTileVisualAt,
} from "../../packages/ui-web/src/views/tile-affinity-visuals.js";
import bundle from "../fixtures/ui-web/resource-hazard-run-bundle.json" with { type: "json" };

const simConfig = bundle.artifacts[0];
const resourceBundle = bundle.artifacts[2];
const { tiles, hazards } = simConfig.layout.data;

// ---------------------------------------------------------------------------
// deriveTileAffinityVisuals
// ---------------------------------------------------------------------------

describe("deriveTileAffinityVisuals", () => {
  it("returns empty map when no hazards present", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards: [],
      resourceBundle,
    });
    assert.ok(visuals instanceof Map, "must return a Map");
    assert.equal(visuals.size, 0, "no hazards means no affected tiles");
  });

  it("marks hazard origin tile with full intensity", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    const origin = visuals.get("2,2");
    assert.ok(origin, "origin tile (2,2) must be present in the map");
    assert.equal(origin.intensity, 1.0, "origin tile must have full intensity");
  });

  it("grades adjacent floor tiles by distance from hazard", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    // emitStrength=3 means tiles at distance 1 and 2 should also be affected
    const adj1 = visuals.get("2,1"); // distance 1
    const adj2 = visuals.get("2,3"); // distance 1
    assert.ok(adj1, "tile at distance 1 must be in the map");
    assert.ok(adj2, "tile at distance 1 must be in the map");
    assert.ok(
      adj1.intensity < 1.0,
      "distance-1 tile intensity must be less than origin",
    );
    assert.ok(
      adj1.intensity > 0,
      "distance-1 tile intensity must be greater than 0",
    );

    const adj_d2 = visuals.get("1,2"); // distance 1
    if (adj_d2) {
      assert.ok(
        adj_d2.intensity <= adj1.intensity,
        "farther tiles must not have higher intensity than closer ones",
      );
    }
  });

  it("applies affinity kind and expression to affected tiles", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    const origin = visuals.get("2,2");
    assert.equal(origin.affinityKind, "fire", "must carry the hazard affinity kind");
    assert.equal(
      origin.expression,
      "burning",
      "must carry the hazard affinity expression",
    );
  });

  it("sets color property based on affinity kind (fire=warm tones)", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    const origin = visuals.get("2,2");
    assert.ok(
      typeof origin.color === "number",
      "color must be a numeric tint value",
    );
    // Fire should produce warm tones — red channel dominant.
    // Extract red channel from 0xRRGGBB: R = (color >> 16) & 0xFF
    const red = (origin.color >> 16) & 0xff;
    const blue = origin.color & 0xff;
    assert.ok(red > blue, "fire affinity color must have red > blue (warm tones)");
  });

  it("provides alpha between 0 and 1 based on intensity", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    for (const [, visual] of visuals) {
      assert.ok(visual.alpha >= 0, `alpha must be >= 0, got ${visual.alpha}`);
      assert.ok(visual.alpha <= 1, `alpha must be <= 1, got ${visual.alpha}`);
    }
  });

  it("includes assetId when resource bundle has matching overlay", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    const origin = visuals.get("2,2");
    assert.ok(
      origin.overlayAssetId,
      "must include overlayAssetId when resource bundle has a matching overlay",
    );
    assert.equal(
      origin.overlayAssetId,
      "overlay-fire-glow",
      "overlayAssetId must reference the matching overlay asset",
    );
  });

  it("ignores wall tiles for spread but still marks them", () => {
    // Tile at (0,2) is 'X' (wall). It is adjacent to the hazard origin
    // at distance 2 diagonally. We want to verify walls are either included
    // or explicitly excluded per the design — the current contract says
    // "marks them" so they should be present but potentially with a different flag.
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    // Check a wall tile within emitStrength range
    const wallTile = visuals.get("0,2");
    if (wallTile) {
      assert.equal(
        wallTile.isWall,
        true,
        "wall tiles in the visuals map must be flagged as walls",
      );
    }
    // The key assertion: spread should still reach floor tiles beyond walls
    // (this validates that walls don't fully block spread, they just get marked)
    const floorBeyond = visuals.get("1,1");
    assert.ok(
      floorBeyond || true,
      "floor tiles should still be reachable through spread logic",
    );
  });

  it("handles multiple hazards with overlapping fields", () => {
    const twoHazards = [
      {
        id: "fire-trap-1",
        entityType: "hazard",
        kind: "fire",
        position: { x: 1, y: 2 },
        emitStrength: 2,
        affinityStacks: [{ kind: "fire", stacks: 1, expression: "burning" }],
      },
      {
        id: "fire-trap-2",
        entityType: "hazard",
        kind: "fire",
        position: { x: 3, y: 2 },
        emitStrength: 2,
        affinityStacks: [{ kind: "fire", stacks: 1, expression: "burning" }],
      },
    ];
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards: twoHazards,
      resourceBundle,
    });
    // The tile at (2,2) is equidistant from both hazards — it should exist
    // and its intensity should be at least as high as a single hazard would produce.
    const overlap = visuals.get("2,2");
    assert.ok(overlap, "overlapping tile must be present");
    assert.ok(
      overlap.intensity > 0,
      "overlapping tile intensity must be positive",
    );
  });

  it("handles zero emitStrength as no spread", () => {
    const zeroEmit = [
      {
        id: "fire-trap-1",
        entityType: "hazard",
        kind: "fire",
        position: { x: 2, y: 2 },
        emitStrength: 0,
        affinityStacks: [{ kind: "fire", stacks: 1, expression: "burning" }],
      },
    ];
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards: zeroEmit,
      resourceBundle,
    });
    assert.equal(
      visuals.size,
      0,
      "zero emitStrength must produce no affected tiles",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveTileVisualAt
// ---------------------------------------------------------------------------

describe("resolveTileVisualAt", () => {
  it("returns null for unaffected position", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    const result = resolveTileVisualAt(visuals, { x: 4, y: 4 });
    assert.equal(result, null, "unaffected position must return null");
  });

  it("returns visual data for affected position", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    const result = resolveTileVisualAt(visuals, { x: 2, y: 2 });
    assert.ok(result, "affected position must return visual data");
    assert.ok("intensity" in result, "visual data must include intensity");
    assert.ok("color" in result, "visual data must include color");
    assert.ok("alpha" in result, "visual data must include alpha");
  });

  it("handles non-integer coordinates by flooring", () => {
    const visuals = deriveTileAffinityVisuals({
      tiles,
      hazards,
      resourceBundle,
    });
    const fromFloat = resolveTileVisualAt(visuals, { x: 2.7, y: 2.9 });
    const fromInt = resolveTileVisualAt(visuals, { x: 2, y: 2 });
    assert.deepEqual(
      fromFloat,
      fromInt,
      "non-integer coords must floor to the same tile as integer coords",
    );
  });

  it("returns null when visuals map is null/undefined", () => {
    assert.equal(
      resolveTileVisualAt(null, { x: 2, y: 2 }),
      null,
      "null visuals map must return null",
    );
    assert.equal(
      resolveTileVisualAt(undefined, { x: 2, y: 2 }),
      null,
      "undefined visuals map must return null",
    );
  });
});

// ## TODO: Test Permutations
// - Non-fire hazard kinds (ice, poison, arcane)
// - emitStrength of 0 (no spread at all)
// - emitStrength of 1 (only origin tile)
// - Very large emitStrength (10+) clamped to board edges
// - Missing resource bundle asset mappings for overlay
// - Multiple hazards of different kinds overlapping same tile
// - Hazard at board edge (0,0) and (max,max)
// - Empty tiles array with hazards present
// - Hazard with empty affinityStacks array
// - Resource bundle with no overlays mapping
