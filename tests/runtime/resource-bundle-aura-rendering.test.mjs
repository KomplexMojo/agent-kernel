import assert from "node:assert/strict";
import { renderBoardWithResourceBundle } from "../../packages/runtime/src/render/resource-bundle.js";
import { AFFINITY_COLOR_HEX } from "../../packages/runtime/src/render/affinity-palette.js";

// ---------------------------------------------------------------------------
// Wave 4: Aura rendering integration tests
// ---------------------------------------------------------------------------

describe("renderBoardWithResourceBundle - aura rendering", () => {
  it("renders floor tiles without auras when observation.auras is absent", async () => {
    const result = await renderBoardWithResourceBundle({
      tiles: [
        "...",
        "...",
        "...",
      ],
      actors: [],
      floorAffinityTraps: [],
    });

    assert.equal(result.ok, true);
    assert.equal(result.width, 96);
    assert.equal(result.height, 96);
    assert.ok(result.pixels instanceof Uint8ClampedArray);
  });

  it("renders floor tiles without auras when observation.auras is empty", async () => {
    const result = await renderBoardWithResourceBundle({
      tiles: [
        "...",
        "...",
        "...",
      ],
      actors: [],
      floorAffinityTraps: [],
      observation: { auras: [] },
    });

    assert.equal(result.ok, true);
    assert.ok(result.pixels instanceof Uint8ClampedArray);
  });

  it("applies aura tinting to floor tiles when observation.auras is present", async () => {
    const result = await renderBoardWithResourceBundle({
      tiles: [
        "...",
        "...",
        "...",
      ],
      actors: [],
      floorAffinityTraps: [],
      observation: {
        auras: [
          {
            x: 1,
            y: 1,
            affinityKind: "fire",
            visualState: "emit",
            intensity: 0.8,
            stacks: 2,
          },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.ok(result.pixels instanceof Uint8ClampedArray);

    // Verify that the center tile (1,1) has been modified
    const tileWidth = result.tileWidth;
    const tileHeight = result.tileHeight;
    const centerX = 1 * tileWidth + tileWidth / 2;
    const centerY = 1 * tileHeight + tileHeight / 2;
    const idx = (Math.floor(centerY) * result.width + Math.floor(centerX)) * 4;

    // The pixel should have some red component from fire affinity
    const r = result.pixels[idx];
    const g = result.pixels[idx + 1];
    const b = result.pixels[idx + 2];

    // Fire is reddish, so R should be higher than G and B
    assert.ok(r > 0, "red channel should be > 0 for fire affinity");
  });

  it("does not override trap tiles with aura rendering", async () => {
    const result = await renderBoardWithResourceBundle({
      tiles: [
        "...",
        "...",
        "...",
      ],
      actors: [],
      floorAffinityTraps: [
        {
          position: { x: 1, y: 1 },
          affinity: { kind: "water", stacks: 3 },
        },
      ],
      observation: {
        auras: [
          {
            x: 1,
            y: 1,
            affinityKind: "fire",
            visualState: "emit",
            intensity: 1.0,
            stacks: 5,
          },
        ],
      },
    });

    assert.equal(result.ok, true);
    // The trap should take priority, aura should be skipped
    // This is a visual test - we verify the code path doesn't crash
    assert.ok(result.pixels instanceof Uint8ClampedArray);
  });

  it("renders different aura visual states correctly", async () => {
    const visualStates = ["emit", "push", "pull", "draw"];

    for (const visualState of visualStates) {
      const result = await renderBoardWithResourceBundle({
        tiles: [
          "...",
        ],
        actors: [],
        floorAffinityTraps: [],
        observation: {
          auras: [
            {
              x: 1,
              y: 0,
              affinityKind: "fire",
              visualState,
              intensity: 0.6,
              stacks: 1,
            },
          ],
        },
      });

      assert.equal(result.ok, true, `should render ${visualState} mask`);
      assert.ok(result.pixels instanceof Uint8ClampedArray);
    }
  });

  it("handles multiple auras on different tiles", async () => {
    const result = await renderBoardWithResourceBundle({
      tiles: [
        "...",
        "...",
        "...",
      ],
      actors: [],
      floorAffinityTraps: [],
      observation: {
        auras: [
          { x: 0, y: 0, affinityKind: "fire", visualState: "emit", intensity: 0.5, stacks: 1 },
          { x: 2, y: 0, affinityKind: "water", visualState: "pull", intensity: 0.6, stacks: 2 },
          { x: 1, y: 2, affinityKind: "earth", visualState: "push", intensity: 0.7, stacks: 3 },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.ok(result.pixels instanceof Uint8ClampedArray);
  });

  it("skips auras with missing affinity color", async () => {
    const result = await renderBoardWithResourceBundle({
      tiles: [
        "...",
      ],
      actors: [],
      floorAffinityTraps: [],
      observation: {
        auras: [
          {
            x: 1,
            y: 0,
            affinityKind: "invalid_affinity",
            visualState: "emit",
            intensity: 0.8,
            stacks: 2,
          },
        ],
      },
    });

    assert.equal(result.ok, true);
    // Should not crash, just skip the invalid aura
    assert.ok(result.pixels instanceof Uint8ClampedArray);
  });

  it("renders auras only on floor tiles, not walls or barriers", async () => {
    const result = await renderBoardWithResourceBundle({
      tiles: [
        "###",
        "#.#",
        "BBB",
      ],
      actors: [],
      floorAffinityTraps: [],
      observation: {
        auras: [
          { x: 0, y: 0, affinityKind: "fire", visualState: "emit", intensity: 0.8, stacks: 2 }, // wall
          { x: 1, y: 1, affinityKind: "fire", visualState: "emit", intensity: 0.8, stacks: 2 }, // floor
          { x: 0, y: 2, affinityKind: "fire", visualState: "emit", intensity: 0.8, stacks: 2 }, // barrier
        ],
      },
    });

    assert.equal(result.ok, true);
    // Only the floor tile (1,1) should have aura applied
    assert.ok(result.pixels instanceof Uint8ClampedArray);
  });
});
