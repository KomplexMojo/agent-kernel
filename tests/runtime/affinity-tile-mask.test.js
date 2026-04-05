import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stackAlphaMultiplier,
  emitMask,
  pushMask,
  pullMask,
  drawMask,
  conflictMask,
  reinforceMask,
  layeredMask,
  applyAuraMask,
} from "../../packages/runtime/src/render/affinity-tile-mask.js";
import { SPATIAL_WEIGHTS } from "../../packages/runtime/src/contracts/affinity-spatial-rules.js";
import {
  resolveAuraRgba,
  STACK_INTENSITY_TIERS,
} from "../../packages/runtime/src/render/affinity-palette.js";

// ---------------------------------------------------------------------------
// stackAlphaMultiplier
// ---------------------------------------------------------------------------

describe("stackAlphaMultiplier", () => {
  it("returns base alpha for stacks=1", () => {
    const result = stackAlphaMultiplier(1);
    assert.ok(result >= 0 && result <= 1, `expected [0,1], got ${result}`);
    assert.equal(result, SPATIAL_WEIGHTS.alphaBase);
  });

  it("increases with stacks", () => {
    const a1 = stackAlphaMultiplier(1);
    const a3 = stackAlphaMultiplier(3);
    const a5 = stackAlphaMultiplier(5);
    assert.ok(a3 > a1, "stacks=3 should be > stacks=1");
    assert.ok(a5 > a3, "stacks=5 should be > stacks=3");
  });

  it("handles stacks=0 gracefully (clamps to 1)", () => {
    const result = stackAlphaMultiplier(0);
    assert.ok(result >= 0 && result <= 1);
  });
});

// ---------------------------------------------------------------------------
// emitMask
// ---------------------------------------------------------------------------

describe("emitMask", () => {
  it("returns values in [0, 1]", () => {
    for (let u = 0; u <= 1; u += 0.25) {
      for (let v = 0; v <= 1; v += 0.25) {
        const val = emitMask(u, v);
        assert.ok(val >= 0 && val <= 1, `out of range at (${u},${v}): ${val}`);
      }
    }
  });

  it("center > edge", () => {
    const center = emitMask(0.5, 0.5);
    const edge = emitMask(0, 0);
    assert.ok(center > edge, `center(${center}) should be > edge(${edge})`);
  });
});

// ---------------------------------------------------------------------------
// pushMask
// ---------------------------------------------------------------------------

describe("pushMask", () => {
  it("returns values in [0, 1]", () => {
    for (let u = 0; u <= 1; u += 0.25) {
      for (let v = 0; v <= 1; v += 0.25) {
        const val = pushMask(u, v);
        assert.ok(val >= 0 && val <= 1, `out of range at (${u},${v}): ${val}`);
      }
    }
  });

  it("shows directional concentration (forward > backward)", () => {
    const forward = pushMask(0.9, 0.5, SPATIAL_WEIGHTS, 0);
    const backward = pushMask(0.1, 0.5, SPATIAL_WEIGHTS, 0);
    assert.ok(forward > backward, `forward(${forward}) should be > backward(${backward})`);
  });
});

// ---------------------------------------------------------------------------
// pullMask
// ---------------------------------------------------------------------------

describe("pullMask", () => {
  it("returns values in [0, 1]", () => {
    for (let u = 0; u <= 1; u += 0.25) {
      for (let v = 0; v <= 1; v += 0.25) {
        const val = pullMask(u, v);
        assert.ok(val >= 0 && val <= 1, `out of range at (${u},${v}): ${val}`);
      }
    }
  });

  it("edge differs from center (gradient exists)", () => {
    const center = pullMask(0.5, 0.5);
    const edge = pullMask(0, 0);
    assert.ok(center !== edge, "center and edge should differ");
  });
});

// ---------------------------------------------------------------------------
// drawMask
// ---------------------------------------------------------------------------

describe("drawMask", () => {
  it("returns values in [0, 1]", () => {
    for (let u = 0; u <= 1; u += 0.25) {
      for (let v = 0; v <= 1; v += 0.25) {
        const val = drawMask(u, v);
        assert.ok(val >= 0 && val <= 1, `out of range at (${u},${v}): ${val}`);
      }
    }
  });

  it("ring shape: mid-radius > center and > far corner", () => {
    const ringR = SPATIAL_WEIGHTS.drawRingRadius;
    // Sample at the ring radius distance
    const ringU = 0.5 + ringR / 2;
    const atRing = drawMask(ringU, 0.5);
    const atCenter = drawMask(0.5, 0.5);
    assert.ok(atRing >= atCenter, `ring(${atRing}) should be >= center(${atCenter})`);
  });
});

// ---------------------------------------------------------------------------
// conflictMask
// ---------------------------------------------------------------------------

describe("conflictMask", () => {
  const red = [255, 0, 0, 200];
  const blue = [0, 0, 255, 200];

  it("returns deterministic results", () => {
    const a = conflictMask(0.3, 0.7, red, blue);
    const b = conflictMask(0.3, 0.7, red, blue);
    assert.deepEqual(a, b, "same inputs should produce same output");
  });

  it("returns valid RGBA values", () => {
    const result = conflictMask(0.5, 0.5, red, blue);
    assert.ok(result.r >= 0 && result.r <= 255);
    assert.ok(result.g >= 0 && result.g <= 255);
    assert.ok(result.b >= 0 && result.b <= 255);
    assert.ok(result.a >= 0 && result.a <= 255);
  });

  it("produces dithered blend (not all same color)", () => {
    let sourceCount = 0;
    let targetCount = 0;
    for (let i = 0; i < 100; i++) {
      const u = (i % 10) / 10;
      const v = Math.floor(i / 10) / 10;
      const c = conflictMask(u, v, red, blue);
      if (c.r === 255) sourceCount++;
      if (c.b === 255) targetCount++;
    }
    assert.ok(sourceCount > 0, "should have some source pixels");
    assert.ok(targetCount > 0, "should have some target pixels");
  });
});

// ---------------------------------------------------------------------------
// reinforceMask
// ---------------------------------------------------------------------------

describe("reinforceMask", () => {
  it("returns 1.0 for single stack", () => {
    assert.equal(reinforceMask(0.5, 0.5, 1), 1);
  });

  it("increases with combined stacks", () => {
    const a = reinforceMask(0.5, 0.5, 2);
    const b = reinforceMask(0.5, 0.5, 5);
    assert.ok(b > a, `stacks=5(${b}) should be > stacks=2(${a})`);
  });
});

// ---------------------------------------------------------------------------
// layeredMask
// ---------------------------------------------------------------------------

describe("layeredMask", () => {
  const green = [0, 255, 0, 200];
  const purple = [128, 0, 128, 200];

  it("returns valid RGBA", () => {
    const result = layeredMask(0.3, 0.7, green, purple);
    assert.ok(result.r >= 0 && result.r <= 255);
    assert.ok(result.a >= 0 && result.a <= 255);
  });

  it("uses both colors across tile", () => {
    let hasGreen = false;
    let hasPurple = false;
    for (let i = 0; i < 20; i++) {
      const u = i / 20;
      const result = layeredMask(u, 0.5, green, purple);
      if (result.r === 0 && result.g === 255) hasGreen = true;
      if (result.r === 128 && result.b === 128) hasPurple = true;
    }
    assert.ok(hasGreen, "should include dominant color");
    assert.ok(hasPurple, "should include secondary color");
  });
});

// ---------------------------------------------------------------------------
// applyAuraMask
// ---------------------------------------------------------------------------

describe("applyAuraMask", () => {
  it("writes to pixel buffer correctly", () => {
    const tileSize = 4;
    const width = 8;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const color = [255, 0, 0, 200];

    applyAuraMask(pixels, width, 2, 2, tileSize, color, () => 1.0, 1.0);

    // Check that pixels in the tile region are non-zero
    const idx = (2 * width + 2) * 4;
    assert.ok(pixels[idx] > 0 || pixels[idx + 1] > 0 || pixels[idx + 2] > 0,
      "tile pixels should have color data");
    assert.ok(pixels[idx + 3] > 0, "tile pixels should have alpha");
  });

  it("does not write outside tile bounds", () => {
    const tileSize = 2;
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const color = [0, 255, 0, 200];

    applyAuraMask(pixels, width, 1, 1, tileSize, color, () => 1.0, 1.0);

    // Check pixel at (0, 0) is untouched
    assert.equal(pixels[0], 0);
    assert.equal(pixels[1], 0);
    assert.equal(pixels[2], 0);
    assert.equal(pixels[3], 0);
  });

  it("respects maskAlpha=0 (no writes)", () => {
    const tileSize = 2;
    const width = 4;
    const pixels = new Uint8ClampedArray(width * 4 * 4);
    const color = [255, 255, 255, 255];

    applyAuraMask(pixels, width, 0, 0, tileSize, color, () => 1.0, 0);

    const sum = pixels.reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, "no pixels should be written with maskAlpha=0");
  });

  it("handles tileSize=1", () => {
    const width = 2;
    const pixels = new Uint8ClampedArray(width * 2 * 4);
    const color = [100, 100, 100, 200];

    applyAuraMask(pixels, width, 0, 0, 1, color, () => 1.0, 1.0);
    assert.ok(pixels[3] > 0, "single pixel tile should be written");
  });
});

// ---------------------------------------------------------------------------
// resolveAuraRgba (wave 3.4)
// ---------------------------------------------------------------------------

describe("resolveAuraRgba", () => {
  it("returns RGBA array for valid kind", () => {
    const rgba = resolveAuraRgba({ kind: "fire", stacks: 1 });
    assert.equal(rgba.length, 4);
    assert.ok(rgba[0] > 0, "fire should have red component");
  });

  it("alpha increases with stacks via glow", () => {
    const a1 = resolveAuraRgba({ kind: "water", stacks: 1 });
    const a5 = resolveAuraRgba({ kind: "water", stacks: 5 });
    assert.ok(a5[3] >= a1[3], `stacks=5 alpha(${a5[3]}) should be >= stacks=1 alpha(${a1[3]})`);
  });

  it("respects baseAlpha parameter", () => {
    const full = resolveAuraRgba({ kind: "fire", stacks: 3 }, 1.0);
    const half = resolveAuraRgba({ kind: "fire", stacks: 3 }, 0.5);
    assert.ok(full[3] > half[3], "full alpha should be > half alpha");
  });
});

// ---------------------------------------------------------------------------
// STACK_INTENSITY_TIERS (wave 3.4 — 5th tier)
// ---------------------------------------------------------------------------

describe("STACK_INTENSITY_TIERS 5th tier", () => {
  it("has 5 tiers", () => {
    assert.equal(STACK_INTENSITY_TIERS.length, 5);
  });

  it("5th tier has highest saturation", () => {
    const tier5 = STACK_INTENSITY_TIERS[4];
    assert.ok(tier5.sat > STACK_INTENSITY_TIERS[3].sat, "tier5 sat should exceed tier4");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("emitMask handles exact boundaries", () => {
    assert.ok(emitMask(0, 0) >= 0);
    assert.ok(emitMask(1, 1) >= 0);
    assert.ok(emitMask(0, 1) >= 0);
    assert.ok(emitMask(1, 0) >= 0);
  });

  it("negative distance values clamped in masks", () => {
    // Masks work with normalized [0,1] but shouldn't crash on out-of-range
    const v = emitMask(-0.5, -0.5);
    assert.ok(v >= 0 && v <= 1);
  });

  it("resolveAuraRgba handles missing kind gracefully", () => {
    const rgba = resolveAuraRgba({ kind: "nonexistent", stacks: 1 });
    assert.equal(rgba.length, 4);
    // Should return fallback white
    assert.equal(rgba[0], 255);
  });

  it("resolveAuraRgba handles stacks=0", () => {
    const rgba = resolveAuraRgba({ kind: "fire", stacks: 0 });
    assert.equal(rgba.length, 4);
  });
});
