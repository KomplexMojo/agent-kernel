import assert from "node:assert/strict";
import {
  AFFINITY_COLOR_HEX,
  STACK_INTENSITY_TIERS,
  hexToRgba,
  normalizeHex,
  resolveStackIntensity,
  getAffinityRgba,
  validateAffinityPalette,
} from "../../packages/runtime/src/render/affinity-palette.js";
import { AFFINITY_KINDS } from "../../packages/runtime/src/contracts/domain-constants.js";

describe("affinity-palette", () => {
  describe("AFFINITY_COLOR_HEX", () => {
    it("should define a hex color for every canonical affinity kind", () => {
      AFFINITY_KINDS.forEach((kind) => {
        assert.ok(
          AFFINITY_COLOR_HEX[kind],
          `Missing palette entry for affinity kind: ${kind}`,
        );
        assert.match(
          AFFINITY_COLOR_HEX[kind],
          /^#[0-9a-f]{6}$/i,
          `Invalid hex color for ${kind}: ${AFFINITY_COLOR_HEX[kind]}`,
        );
      });
    });

    it("should have exactly 10 affinity entries", () => {
      assert.equal(Object.keys(AFFINITY_COLOR_HEX).length, 10);
    });

    it("should provide the expected colors for key affinities", () => {
      assert.equal(AFFINITY_COLOR_HEX.fire, "#f05a28");
      assert.equal(AFFINITY_COLOR_HEX.water, "#2b7fff");
      assert.equal(AFFINITY_COLOR_HEX.light, "#f5d14d");
      assert.equal(AFFINITY_COLOR_HEX.dark, "#3a2a57");
    });
  });

  describe("STACK_INTENSITY_TIERS", () => {
    it("should define at least 3 intensity tiers", () => {
      assert.ok(STACK_INTENSITY_TIERS.length >= 3);
    });

    it("should have increasing saturation and decreasing lightness", () => {
      for (let i = 1; i < STACK_INTENSITY_TIERS.length; i += 1) {
        const prev = STACK_INTENSITY_TIERS[i - 1];
        const curr = STACK_INTENSITY_TIERS[i];
        assert.ok(curr.sat >= prev.sat);
        assert.ok(curr.light <= prev.light);
      }
    });

    it("should have glow values that increase or stay constant", () => {
      for (let i = 1; i < STACK_INTENSITY_TIERS.length; i += 1) {
        const prev = STACK_INTENSITY_TIERS[i - 1];
        const curr = STACK_INTENSITY_TIERS[i];
        assert.ok(curr.glow >= prev.glow);
      }
    });
  });

  describe("hexToRgba", () => {
    it("should convert valid hex to RGBA", () => {
      const rgba = hexToRgba("#f05a28");
      assert.deepEqual(rgba, [240, 90, 40, 255]);
    });

    it("should apply custom alpha", () => {
      const rgba = hexToRgba("#f05a28", 128);
      assert.deepEqual(rgba, [240, 90, 40, 128]);
    });

    it("should fallback to black for invalid hex", () => {
      const rgba = hexToRgba("invalid");
      assert.deepEqual(rgba, [0, 0, 0, 255]);
    });
  });

  describe("normalizeHex", () => {
    it("should return valid hex unchanged", () => {
      assert.equal(normalizeHex("#f05a28", "#000000"), "#f05a28");
    });

    it("should normalize uppercase to lowercase", () => {
      assert.equal(normalizeHex("#F05A28", "#000000"), "#f05a28");
    });

    it("should return fallback for invalid hex", () => {
      assert.equal(normalizeHex("not-a-color", "#ffffff"), "#ffffff");
      assert.equal(normalizeHex("#fff", "#ffffff"), "#ffffff");
    });
  });

  describe("resolveStackIntensity", () => {
    it("should return tier1 for stack count 1", () => {
      const result = resolveStackIntensity(1);
      assert.equal(result.sat, 55);
      assert.equal(result.light, 55);
      assert.equal(result.glow, 0);
      assert.equal(result.stacks, 1);
    });

    it("should return tier2 for stack count 2", () => {
      const result = resolveStackIntensity(2);
      assert.equal(result.sat, 65);
      assert.equal(result.light, 50);
      assert.equal(result.glow, 4);
      assert.equal(result.stacks, 2);
    });

    it("should return tier3 for stack count 3", () => {
      const result = resolveStackIntensity(3);
      assert.equal(result.sat, 75);
      assert.equal(result.light, 45);
      assert.equal(result.glow, 6);
      assert.equal(result.stacks, 3);
    });

    it("should cap at highest tier for stack count >= 5", () => {
      const result = resolveStackIntensity(10);
      assert.equal(result.sat, 95);
      assert.equal(result.light, 35);
      assert.equal(result.glow, 10);
      assert.equal(result.stacks, 10);
    });

    it("should normalize non-integer stacks to nearest positive integer", () => {
      assert.equal(resolveStackIntensity(2.7).stacks, 3);
      assert.equal(resolveStackIntensity(0).stacks, 1);
      assert.equal(resolveStackIntensity(-5).stacks, 1);
    });
  });

  describe("getAffinityRgba", () => {
    it("should return RGBA for valid affinity kind", () => {
      const rgba = getAffinityRgba("fire");
      assert.deepEqual(rgba, [240, 90, 40, 255]);
    });

    it("should apply custom alpha", () => {
      const rgba = getAffinityRgba("water", 128);
      assert.equal(rgba[3], 128);
    });

    it("should fallback to white for unknown affinity kind", () => {
      const rgba = getAffinityRgba("unknown");
      assert.deepEqual(rgba, [255, 255, 255, 255]);
    });
  });

  describe("validateAffinityPalette", () => {
    it("should pass validation for complete palette", () => {
      const result = validateAffinityPalette();
      assert.equal(result.ok, true);
      assert.equal(result.missing.length, 0);
    });
  });
});
