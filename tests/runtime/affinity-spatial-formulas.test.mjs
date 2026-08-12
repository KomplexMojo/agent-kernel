import assert from "node:assert/strict";
import {
  computeRadius,
  computeIntensity,
  computePotency,
  resolveStackCancellation,
  resolveMergedStacks,
  computeEffectivePotency,
  computeManaCost,
  computeStackAlphaMultiplier,
  computeTileAlpha,
} from "../../packages/runtime/src/render/affinity-spatial-formulas.js";
import { SPATIAL_WEIGHTS } from "../../packages/runtime/src/contracts/affinity-spatial-rules.js";

const W = SPATIAL_WEIGHTS;

// ---------------------------------------------------------------------------
// §1.1 computeRadius
// ---------------------------------------------------------------------------

describe("computeRadius", () => {
  describe("push", () => {
    it("stacks 1-2 → radius 1", () => {
      assert.equal(computeRadius("push", 1, W), 1);
      assert.equal(computeRadius("push", 2, W), 1);
    });
    it("stacks 3-4 → radius 2", () => {
      assert.equal(computeRadius("push", 3, W), 2);
      assert.equal(computeRadius("push", 4, W), 2);
    });
    it("stacks 5 → radius 3", () => {
      assert.equal(computeRadius("push", 5, W), 3);
    });
  });

  describe("pull mirrors push", () => {
    it("produces same radius as push at all stack levels", () => {
      for (let s = 1; s <= 5; s += 1) {
        assert.equal(computeRadius("pull", s, W), computeRadius("push", s, W));
      }
    });
  });

  describe("emit", () => {
    it("stacks 1 → radius 2 (buffer + 1 tile)", () => {
      assert.equal(computeRadius("emit", 1, W), 2);
    });
    it("stacks 2 → radius 3", () => {
      assert.equal(computeRadius("emit", 2, W), 3);
    });
    it("stacks 5 → radius 6", () => {
      assert.equal(computeRadius("emit", 5, W), 6);
    });
  });

  describe("draw", () => {
    it("always radius 1 regardless of stacks", () => {
      for (let s = 1; s <= 5; s += 1) {
        assert.equal(computeRadius("draw", s, W), 1);
      }
    });
  });

  describe("edge cases", () => {
    it("returns 1 for unknown expression", () => {
      assert.equal(computeRadius("unknown", 3, W), 1);
    });
    it("clamps stacks < 1 to 1", () => {
      assert.equal(computeRadius("push", 0, W), computeRadius("push", 1, W));
      assert.equal(computeRadius("push", -5, W), computeRadius("push", 1, W));
    });
  });
});

// ---------------------------------------------------------------------------
// §1.2 computeIntensity
// ---------------------------------------------------------------------------

describe("computeIntensity", () => {
  describe("emit buffer zone", () => {
    it("d=1 is always 0 (buffer)", () => {
      for (let s = 1; s <= 5; s += 1) {
        assert.equal(computeIntensity(1, s, "emit", W), 0,
          `emit stacks=${s} d=1 should be 0`);
      }
    });

    it("d=2 is non-zero for stacks >= 1", () => {
      assert.ok(computeIntensity(2, 1, "emit", W) > 0);
      assert.ok(computeIntensity(2, 3, "emit", W) > 0);
    });
  });

  describe("emit falloff at d=2 is full peak at each stack level", () => {
    it("d=2 is highest intensity for emit", () => {
      for (let s = 2; s <= 5; s += 1) {
        const atD2 = computeIntensity(2, s, "emit", W);
        const atD3 = computeIntensity(3, s, "emit", W);
        assert.ok(atD2 >= atD3,
          `emit stacks=${s}: d=2 (${atD2}) should be >= d=3 (${atD3})`);
      }
    });
  });

  describe("emit out-of-range is zero", () => {
    it("stacks=1 radius=2: d=3 → 0", () => {
      assert.equal(computeIntensity(3, 1, "emit", W), 0);
    });
    it("stacks=2 radius=3: d=4 → 0", () => {
      assert.equal(computeIntensity(4, 2, "emit", W), 0);
    });
  });

  describe("push — no buffer, starts at d=1", () => {
    it("d=1 reaches zero for push stack 1 under the current quadratic falloff", () => {
      assert.equal(computeIntensity(1, 1, "push", W), 0);
    });
    it("d=1 > d=2 for push (quadratic falloff)", () => {
      const d1 = computeIntensity(1, 3, "push", W);
      const d2 = computeIntensity(2, 3, "push", W);
      assert.ok(d1 > d2, `push stacks=3: d=1 (${d1}) should be > d=2 (${d2})`);
    });
    it("d=0 → 0 (no effect at source tile)", () => {
      assert.equal(computeIntensity(0, 2, "push", W), 0);
    });
  });

  describe("pull mirrors push intensity", () => {
    it("pull and push have identical intensity at same d and stacks", () => {
      for (let s = 1; s <= 4; s += 1) {
        for (let d = 1; d <= 3; d += 1) {
          assert.equal(
            computeIntensity(d, s, "pull", W),
            computeIntensity(d, s, "push", W),
            `pull vs push stacks=${s} d=${d}`,
          );
        }
      }
    });
  });

  describe("draw — flat at d=1, zero everywhere else", () => {
    it("d=1 is non-zero", () => {
      assert.ok(computeIntensity(1, 2, "draw", W) > 0);
    });
    it("d=2 is zero (out of range)", () => {
      assert.equal(computeIntensity(2, 5, "draw", W), 0);
    });
    it("d=1 intensity same regardless of stacks (flat)", () => {
      const atS1 = computeIntensity(1, 1, "draw", W);
      const atS5 = computeIntensity(1, 5, "draw", W);
      assert.equal(atS1, atS5);
    });
  });

  describe("returns 0 for unknown expression", () => {
    it("unknown expression → 0", () => {
      assert.equal(computeIntensity(1, 2, "unknown", W), 0);
    });
  });
});

// ---------------------------------------------------------------------------
// §1.3 computePotency
// ---------------------------------------------------------------------------

describe("computePotency", () => {
  describe("push uses quadratic scaling", () => {
    it("stacks 1 → 1", () => assert.equal(computePotency(1, "push", W), 1));
    it("stacks 2 → 4", () => assert.equal(computePotency(2, "push", W), 4));
    it("stacks 3 → 9", () => assert.equal(computePotency(3, "push", W), 9));
    it("stacks 4 → 16", () => assert.equal(computePotency(4, "push", W), 16));
    it("stacks 5 → 25", () => assert.equal(computePotency(5, "push", W), 25));
  });

  describe("pull uses linear scaling", () => {
    for (let s = 1; s <= 5; s += 1) {
      it(`stacks ${s} → ${s}`, () => assert.equal(computePotency(s, "pull", W), s));
    }
  });

  describe("emit uses linear scaling", () => {
    for (let s = 1; s <= 5; s += 1) {
      it(`stacks ${s} → ${s}`, () => assert.equal(computePotency(s, "emit", W), s));
    }
  });

  describe("draw uses linear scaling", () => {
    for (let s = 1; s <= 5; s += 1) {
      it(`stacks ${s} → ${s}`, () => assert.equal(computePotency(s, "draw", W), s));
    }
  });

  it("returns 0 for unknown expression", () => {
    assert.equal(computePotency(3, "unknown", W), 0);
  });

  it("clamps stacks < 1 to 1", () => {
    assert.equal(computePotency(0, "pull", W), computePotency(1, "pull", W));
  });
});

// ---------------------------------------------------------------------------
// §1.4 resolveStackCancellation
// ---------------------------------------------------------------------------

describe("resolveStackCancellation", () => {
  it("fire+5 vs water+2: netFire=3, netWater=0, canceled=2", () => {
    const result = resolveStackCancellation(5, 2);
    assert.equal(result.canceled, 2);
    assert.equal(result.netSource, 3);
    assert.equal(result.netTarget, 0);
  });

  it("equal stacks: mutual cancellation, both net=0", () => {
    const result = resolveStackCancellation(3, 3);
    assert.equal(result.canceled, 3);
    assert.equal(result.netSource, 0);
    assert.equal(result.netTarget, 0);
  });

  it("source weaker: netSource=0, netTarget has remainder", () => {
    const result = resolveStackCancellation(2, 4);
    assert.equal(result.canceled, 2);
    assert.equal(result.netSource, 0);
    assert.equal(result.netTarget, 2);
  });

  it("stacks=1 vs stacks=1: both net=0", () => {
    const result = resolveStackCancellation(1, 1);
    assert.equal(result.netSource, 0);
    assert.equal(result.netTarget, 0);
  });

  it("clamps invalid stacks to 1", () => {
    const result = resolveStackCancellation(0, 2);
    assert.equal(result.netSource, 0);
    assert.equal(result.netTarget, 1);
  });
});

// ---------------------------------------------------------------------------
// §1.5 resolveMergedStacks
// ---------------------------------------------------------------------------

describe("resolveMergedStacks", () => {
  it("sums stacks when under cap", () => {
    assert.equal(resolveMergedStacks(3, 2, W), 5);
  });
  it("caps at W.maxMergedStacks (8)", () => {
    assert.equal(resolveMergedStacks(5, 5, W), 8);
  });
  it("single stack from each: 1+1=2", () => {
    assert.equal(resolveMergedStacks(1, 1, W), 2);
  });
});

// ---------------------------------------------------------------------------
// §1.6 computeEffectivePotency
// ---------------------------------------------------------------------------

describe("computeEffectivePotency", () => {
  describe("opposite affinity", () => {
    it("fire+5+emit vs water+2+emit: winner gets potency(3)", () => {
      const result = computeEffectivePotency(5, 2, "opposite", "emit", W);
      assert.equal(result, computePotency(3, "emit", W));
      assert.equal(result, 3);
    });

    it("equal stacks: potency(0) = 0", () => {
      const result = computeEffectivePotency(3, 3, "opposite", "emit", W);
      assert.equal(result, 1);
    });

    it("decay+4+pull vs life+2+pull: net decay=2", () => {
      const result = computeEffectivePotency(4, 2, "opposite", "pull", W);
      assert.equal(result, computePotency(2, "pull", W));
      assert.equal(result, 2);
    });
  });

  describe("same affinity", () => {
    it("uses source stacks directly", () => {
      assert.equal(computeEffectivePotency(3, 5, "same", "push", W), computePotency(3, "push", W));
    });
  });

  describe("unrelated affinity", () => {
    it("uses source stacks directly", () => {
      assert.equal(computeEffectivePotency(2, 4, "unrelated", "pull", W), computePotency(2, "pull", W));
    });
  });
});

// ---------------------------------------------------------------------------
// §1.7 computeManaCost
// ---------------------------------------------------------------------------

describe("computeManaCost", () => {
  describe("push/pull have no per-tick cost", () => {
    it("push stacks 1-5 all → 0", () => {
      for (let s = 1; s <= 5; s += 1) {
        assert.equal(computeManaCost(s, "push", W), 0, `push s=${s}`);
      }
    });
    it("pull stacks 1-5 all → 0", () => {
      for (let s = 1; s <= 5; s += 1) {
        assert.equal(computeManaCost(s, "pull", W), 0, `pull s=${s}`);
      }
    });
  });

  describe("emit has quadratic per-tick cost", () => {
    it("stacks 1 → 2", () => assert.equal(computeManaCost(1, "emit", W), 2));
    it("stacks 2 → 3 (1 + 0.5*4 = 3)", () => assert.equal(computeManaCost(2, "emit", W), 3));
    it("stacks 3 → 6 (1 + 0.5*9 = 5.5 → ceil = 6)", () => assert.equal(computeManaCost(3, "emit", W), 6));
    it("increases with stacks", () => {
      for (let s = 2; s <= 5; s += 1) {
        assert.ok(computeManaCost(s, "emit", W) > computeManaCost(s - 1, "emit", W),
          `emit mana cost should increase at s=${s}`);
      }
    });
  });

  describe("draw has lower quadratic cost", () => {
    it("stacks 1 → 1", () => assert.equal(computeManaCost(1, "draw", W), 1));
    it("stacks 2 → 1 (0.25*4 = 1)", () => assert.equal(computeManaCost(2, "draw", W), 1));
    it("draw always cheaper than emit at same stacks", () => {
      for (let s = 2; s <= 5; s += 1) {
        assert.ok(computeManaCost(s, "draw", W) < computeManaCost(s, "emit", W),
          `draw should cost less than emit at s=${s}`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §2.2 computeStackAlphaMultiplier
// ---------------------------------------------------------------------------

describe("computeStackAlphaMultiplier", () => {
  it("stacks=1 returns W.alphaBase (0.20)", () => {
    assert.equal(computeStackAlphaMultiplier(1, W), W.alphaBase);
  });

  it("increases with stacks", () => {
    for (let s = 2; s <= 5; s += 1) {
      assert.ok(
        computeStackAlphaMultiplier(s, W) > computeStackAlphaMultiplier(s - 1, W),
        `alpha multiplier should increase at s=${s}`,
      );
    }
  });

  it("stacks=5 stays below 1.0", () => {
    assert.ok(computeStackAlphaMultiplier(5, W) < 1.0);
  });
});

// ---------------------------------------------------------------------------
// computeTileAlpha — convenience
// ---------------------------------------------------------------------------

describe("computeTileAlpha", () => {
  it("emit buffer zone (d=1) → alpha 0", () => {
    assert.equal(computeTileAlpha(1, 2, "emit", W), 0);
  });

  it("emit d=2 stacks=2 → non-zero alpha", () => {
    assert.ok(computeTileAlpha(2, 2, "emit", W) > 0);
  });

  it("push d=1 stacks=1 → alpha 0 under the current falloff", () => {
    assert.equal(computeTileAlpha(1, 1, "push", W), 0);
  });

  it("push out of range → 0", () => {
    assert.equal(computeTileAlpha(10, 1, "push", W), 0);
  });

  it("result always in [0, 1]", () => {
    const expressions = ["push", "pull", "emit", "draw"];
    expressions.forEach((expr) => {
      for (let s = 1; s <= 5; s += 1) {
        for (let d = 0; d <= 7; d += 1) {
          const alpha = computeTileAlpha(d, s, expr, W);
          assert.ok(alpha >= 0 && alpha <= 1,
            `alpha out of range for ${expr} s=${s} d=${d}: ${alpha}`);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// INTERACTION_MATRIX completeness
// ---------------------------------------------------------------------------

describe("INTERACTION_MATRIX", async () => {
  const { INTERACTION_MATRIX, SPATIAL_EXPRESSIONS } = await import(
    "../../packages/runtime/src/contracts/affinity-spatial-rules.js"
  );
  const relationships = ["same", "opposite", "unrelated"];

  it("has entries for all 4 source expressions", () => {
    SPATIAL_EXPRESSIONS.forEach((expr) => {
      assert.ok(INTERACTION_MATRIX[expr], `Missing source expression: ${expr}`);
    });
  });

  it("each source expression has entries for all 4 target expressions", () => {
    SPATIAL_EXPRESSIONS.forEach((src) => {
      SPATIAL_EXPRESSIONS.forEach((tgt) => {
        assert.ok(
          INTERACTION_MATRIX[src][tgt],
          `Missing matrix cell [${src}][${tgt}]`,
        );
      });
    });
  });

  it("each cell has all 3 affinity relationships", () => {
    SPATIAL_EXPRESSIONS.forEach((src) => {
      SPATIAL_EXPRESSIONS.forEach((tgt) => {
        relationships.forEach((rel) => {
          assert.ok(
            INTERACTION_MATRIX[src][tgt][rel],
            `Missing relationship [${src}][${tgt}][${rel}]`,
          );
        });
      });
    });
  });

  it("each cell has required fields", () => {
    SPATIAL_EXPRESSIONS.forEach((src) => {
      SPATIAL_EXPRESSIONS.forEach((tgt) => {
        relationships.forEach((rel) => {
          const c = INTERACTION_MATRIX[src][tgt][rel];
          assert.ok(typeof c.sourceEffect === "string", `[${src}][${tgt}][${rel}] missing sourceEffect`);
          assert.ok(typeof c.targetEffect === "string", `[${src}][${tgt}][${rel}] missing targetEffect`);
          assert.ok(typeof c.visualState === "string", `[${src}][${tgt}][${rel}] missing visualState`);
          assert.ok(typeof c.formula === "string", `[${src}][${tgt}][${rel}] missing formula`);
        });
      });
    });
  });

  it("all 48 cells are defined (4 src × 4 tgt × 3 rel)", () => {
    let count = 0;
    SPATIAL_EXPRESSIONS.forEach((src) => {
      SPATIAL_EXPRESSIONS.forEach((tgt) => {
        relationships.forEach((rel) => {
          if (INTERACTION_MATRIX[src][tgt]?.[rel]) count += 1;
        });
      });
    });
    assert.equal(count, 48);
  });
});
