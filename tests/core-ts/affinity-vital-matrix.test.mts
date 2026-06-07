/**
 * M1 — Affinity × Expression × Vital matrix: failing tests
 *
 * These tests specify the shape and contents of a complete 10 × 4 × 4 matrix
 * mapping (AffinityKind, AffinityExpression, VitalKind) → signed integer
 * base magnitude, plus the pure scaling helpers that drive `effect = base * stacks`.
 *
 * Tests MUST FAIL until M2 implements:
 *   - getAffinityVitalEffectBase(kind, expression, vital): signed base magnitude (can be 0)
 *   - scaleAffinityVitalEffect(base, stacks): formula multiplier (linear for this milestone)
 *   - getAffinityVitalEffect(kind, expression, vital, stacks): convenience = scale(base, stacks)
 *
 * Implementation matrix (from M1 contract, Codex defaults):
 *   - Base magnitudes: push/pull = 2, emit/draw = 1
 *   - Each affinity has 4 non-zero cells (its primary vital × 4 expressions)
 *   - All other cells = explicit 0
 *   - Per-affinity polarity (positive sign = buff, negative sign = drain):
 *       Fire    → -Health (drain)        Decay   → -Health (drain)
 *       Water   → +Health (buff)         Life    → +Health (buff)
 *       Wind    → -Stamina (drain)       Earth   → +Durability (buff)
 *       Corrode → -Durability (drain)    Fortify → +Durability (buff)
 *       Dark    → -Mana (drain)          Light   → +Mana (buff)
 *   - Push and Emit carry the polarity sign on the primary vital.
 *   - Pull and Draw carry the OPPOSITE sign on the same vital (sign-reversal pair).
 *   - Stacks scale linearly: effect = base * stacks.
 *
 * Architecture: core-ts only — no runtime, no IO, no clocks.
 */
import { describe, expect, test } from "vitest";

import {
  AffinityExpression,
  AffinityKind,
} from "../../packages/core-ts/src/state/affinity.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AFFINITY_KIND_COUNT = 10;
const AFFINITY_EXPRESSION_COUNT = 4;
const VITAL_COUNT = 4;

const ALL_AFFINITY_KINDS = Object.values(AffinityKind);
const ALL_EXPRESSIONS = Object.values(AffinityExpression);
const ALL_VITALS = Object.values(VitalKind);

// Primary vital + polarity per affinity (push/emit carry this sign).
// pull/draw invert the sign on the same vital.
const PRIMARY = {
  [AffinityKind.Fire]:    { vital: VitalKind.Health,     polarity: -1 },
  [AffinityKind.Water]:   { vital: VitalKind.Health,     polarity: +1 },
  [AffinityKind.Earth]:   { vital: VitalKind.Durability, polarity: +1 },
  [AffinityKind.Wind]:    { vital: VitalKind.Stamina,    polarity: -1 },
  [AffinityKind.Life]:    { vital: VitalKind.Health,     polarity: +1 },
  [AffinityKind.Decay]:   { vital: VitalKind.Health,     polarity: -1 },
  [AffinityKind.Corrode]: { vital: VitalKind.Durability, polarity: -1 },
  [AffinityKind.Fortify]: { vital: VitalKind.Durability, polarity: +1 },
  [AffinityKind.Light]:   { vital: VitalKind.Mana,       polarity: +1 },
  [AffinityKind.Dark]:    { vital: VitalKind.Mana,       polarity: -1 },
} as const;

const BASE_PUSH_PULL = 2; // single-target discrete intensity
const BASE_EMIT_DRAW = 1; // diffuse area per-target intensity

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable export — M2 must implement this");
  }
  return fn(...args);
}

/** Expected base for any (kind, expression, vital) cell. 0 if not the primary vital. */
function expectedBase(kind: number, expression: number, vital: number): number {
  const primary = PRIMARY[kind as keyof typeof PRIMARY];
  if (!primary || primary.vital !== vital) return 0;
  const magnitude = (expression === AffinityExpression.Push || expression === AffinityExpression.Pull)
    ? BASE_PUSH_PULL
    : BASE_EMIT_DRAW;
  const isReversed = expression === AffinityExpression.Pull || expression === AffinityExpression.Draw;
  const sign = isReversed ? -primary.polarity : primary.polarity;
  return sign * magnitude;
}

// ---------------------------------------------------------------------------
// API presence (drives M2 implementation)
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: API surface", () => {
  test("getAffinityVitalEffectBase is exported from state/affinity.ts", async () => {
    const mod = await import("../../packages/core-ts/src/state/affinity.ts");
    expect(typeof (mod as Record<string, unknown>).getAffinityVitalEffectBase).toBe("function");
  });

  test("scaleAffinityVitalEffect is exported from state/affinity.ts", async () => {
    const mod = await import("../../packages/core-ts/src/state/affinity.ts");
    expect(typeof (mod as Record<string, unknown>).scaleAffinityVitalEffect).toBe("function");
  });

  test("getAffinityVitalEffect is exported from state/affinity.ts", async () => {
    const mod = await import("../../packages/core-ts/src/state/affinity.ts");
    expect(typeof (mod as Record<string, unknown>).getAffinityVitalEffect).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Matrix shape — 160 addressable cells
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: shape", () => {
  test("matrix is 10 affinities × 4 expressions × 4 vitals = 160 cells", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    let count = 0;
    for (const kind of ALL_AFFINITY_KINDS) {
      for (const expr of ALL_EXPRESSIONS) {
        for (const vital of ALL_VITALS) {
          const v = call(getAffinityVitalEffectBase, kind, expr, vital);
          expect(typeof v).toBe("number");
          count++;
        }
      }
    }
    expect(count).toBe(AFFINITY_KIND_COUNT * AFFINITY_EXPRESSION_COUNT * VITAL_COUNT);
    expect(count).toBe(160);
  });

  test("every (kind, expression, vital) cell returns an integer (0 for no-effect)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const kind of ALL_AFFINITY_KINDS) {
      for (const expr of ALL_EXPRESSIONS) {
        for (const vital of ALL_VITALS) {
          const v = call(getAffinityVitalEffectBase, kind, expr, vital) as number;
          expect(Number.isInteger(v)).toBe(true);
        }
      }
    }
  });

  test("invalid affinity kind returns 0 (out-of-band sentinel)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    expect(call(getAffinityVitalEffectBase, 0, AffinityExpression.Push, VitalKind.Health)).toBe(0);
    expect(call(getAffinityVitalEffectBase, 99, AffinityExpression.Push, VitalKind.Health)).toBe(0);
    expect(call(getAffinityVitalEffectBase, -1, AffinityExpression.Push, VitalKind.Health)).toBe(0);
  });

  test("invalid expression returns 0", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    expect(call(getAffinityVitalEffectBase, AffinityKind.Fire, 0, VitalKind.Health)).toBe(0);
    expect(call(getAffinityVitalEffectBase, AffinityKind.Fire, 99, VitalKind.Health)).toBe(0);
  });

  test("invalid vital returns 0", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    expect(call(getAffinityVitalEffectBase, AffinityKind.Fire, AffinityExpression.Push, 99)).toBe(0);
    expect(call(getAffinityVitalEffectBase, AffinityKind.Fire, AffinityExpression.Push, -1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// "No effect" matrix cells — explicit 0 (not null/undefined/omitted)
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: no-effect cells stored as explicit 0", () => {
  test("decay on durability is 0 (worked example: decay must not affect durability)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const expr of ALL_EXPRESSIONS) {
      const v = call(getAffinityVitalEffectBase, AffinityKind.Decay, expr, VitalKind.Durability);
      expect(v).toBe(0);
    }
  });

  test("fire on mana is 0 (not in primary mapping)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const expr of ALL_EXPRESSIONS) {
      const v = call(getAffinityVitalEffectBase, AffinityKind.Fire, expr, VitalKind.Mana);
      expect(v).toBe(0);
    }
  });

  test("for any affinity, exactly one vital (its primary) is non-zero across all expressions", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const kind of ALL_AFFINITY_KINDS) {
      const nonZeroVitals = new Set<number>();
      for (const vital of ALL_VITALS) {
        for (const expr of ALL_EXPRESSIONS) {
          if ((call(getAffinityVitalEffectBase, kind, expr, vital) as number) !== 0) {
            nonZeroVitals.add(vital);
          }
        }
      }
      expect(nonZeroVitals.size).toBe(1);
      const expected = PRIMARY[kind as keyof typeof PRIMARY]?.vital;
      expect([...nonZeroVitals][0]).toBe(expected);
    }
  });

  test("aggregate: exactly 40 of 160 cells are non-zero (10 affinities × 4 expressions each on primary vital)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    let nonZero = 0;
    for (const kind of ALL_AFFINITY_KINDS) {
      for (const expr of ALL_EXPRESSIONS) {
        for (const vital of ALL_VITALS) {
          if ((call(getAffinityVitalEffectBase, kind, expr, vital) as number) !== 0) {
            nonZero++;
          }
        }
      }
    }
    expect(nonZero).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Worked examples from the M1 contract
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: worked examples from M1 contract", () => {
  test("decay+push drains health (negative on Health)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const v = call(getAffinityVitalEffectBase, AffinityKind.Decay, AffinityExpression.Push, VitalKind.Health) as number;
    expect(v).toBeLessThan(0);
    expect(v).toBe(-BASE_PUSH_PULL);
  });

  test("corrode+push drains durability (negative on Durability)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const v = call(getAffinityVitalEffectBase, AffinityKind.Corrode, AffinityExpression.Push, VitalKind.Durability) as number;
    expect(v).toBe(-BASE_PUSH_PULL);
  });

  test("fortify+push buffs durability (positive on Durability)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const v = call(getAffinityVitalEffectBase, AffinityKind.Fortify, AffinityExpression.Push, VitalKind.Durability) as number;
    expect(v).toBe(+BASE_PUSH_PULL);
  });

  test("life+push buffs health, life+pull drains health (equal magnitude, opposite sign)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const push = call(getAffinityVitalEffectBase, AffinityKind.Life, AffinityExpression.Push, VitalKind.Health) as number;
    const pull = call(getAffinityVitalEffectBase, AffinityKind.Life, AffinityExpression.Pull, VitalKind.Health) as number;
    expect(push).toBe(+BASE_PUSH_PULL);
    expect(pull).toBe(-BASE_PUSH_PULL);
    expect(push).toBe(-pull);
  });

  test("life+emit is a group ambient heal (positive on Health, diffuse magnitude)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const v = call(getAffinityVitalEffectBase, AffinityKind.Life, AffinityExpression.Emit, VitalKind.Health) as number;
    expect(v).toBe(+BASE_EMIT_DRAW);
  });

  test("wind+push affects stamina (negative on Stamina, area-denial intent)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const v = call(getAffinityVitalEffectBase, AffinityKind.Wind, AffinityExpression.Push, VitalKind.Stamina) as number;
    expect(v).toBe(-BASE_PUSH_PULL);
  });

  test("earth+push and earth+emit are both durability buffs", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const push = call(getAffinityVitalEffectBase, AffinityKind.Earth, AffinityExpression.Push, VitalKind.Durability) as number;
    const emit = call(getAffinityVitalEffectBase, AffinityKind.Earth, AffinityExpression.Emit, VitalKind.Durability) as number;
    expect(push).toBe(+BASE_PUSH_PULL);
    expect(emit).toBe(+BASE_EMIT_DRAW);
  });
});

// ---------------------------------------------------------------------------
// Sign-reversal pattern — push↔pull and emit↔draw on the same vital
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: sign-reversal pairs", () => {
  test("push and pull always have opposite signs and equal magnitude on the primary vital", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const kind of ALL_AFFINITY_KINDS) {
      const vital = PRIMARY[kind as keyof typeof PRIMARY].vital;
      const push = call(getAffinityVitalEffectBase, kind, AffinityExpression.Push, vital) as number;
      const pull = call(getAffinityVitalEffectBase, kind, AffinityExpression.Pull, vital) as number;
      expect(push).toBe(-pull);
      expect(Math.abs(push)).toBe(BASE_PUSH_PULL);
    }
  });

  test("emit and draw always have opposite signs and equal magnitude on the primary vital", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const kind of ALL_AFFINITY_KINDS) {
      const vital = PRIMARY[kind as keyof typeof PRIMARY].vital;
      const emit = call(getAffinityVitalEffectBase, kind, AffinityExpression.Emit, vital) as number;
      const draw = call(getAffinityVitalEffectBase, kind, AffinityExpression.Draw, vital) as number;
      expect(emit).toBe(-draw);
      expect(Math.abs(emit)).toBe(BASE_EMIT_DRAW);
    }
  });

  test("push/emit share polarity sign on the primary vital (both reflect the affinity's intrinsic polarity)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const kind of ALL_AFFINITY_KINDS) {
      const vital = PRIMARY[kind as keyof typeof PRIMARY].vital;
      const push = call(getAffinityVitalEffectBase, kind, AffinityExpression.Push, vital) as number;
      const emit = call(getAffinityVitalEffectBase, kind, AffinityExpression.Emit, vital) as number;
      expect(Math.sign(push)).toBe(Math.sign(emit));
    }
  });

  test("emit per-target intensity is strictly lower than push for the same affinity (diffuse trade-off)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const kind of ALL_AFFINITY_KINDS) {
      const vital = PRIMARY[kind as keyof typeof PRIMARY].vital;
      const push = call(getAffinityVitalEffectBase, kind, AffinityExpression.Push, vital) as number;
      const emit = call(getAffinityVitalEffectBase, kind, AffinityExpression.Emit, vital) as number;
      expect(Math.abs(emit)).toBeLessThan(Math.abs(push));
    }
  });
});

// ---------------------------------------------------------------------------
// Every-vital drain + buff coverage
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: every vital is both drainable and buffable", () => {
  test("each vital has at least one (kind, expression) pair that drains (negative effect)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const vital of ALL_VITALS) {
      let found = false;
      outer: for (const kind of ALL_AFFINITY_KINDS) {
        for (const expr of ALL_EXPRESSIONS) {
          if ((call(getAffinityVitalEffectBase, kind, expr, vital) as number) < 0) {
            found = true;
            break outer;
          }
        }
      }
      expect(found, `vital ${vital} must have at least one draining pair`).toBe(true);
    }
  });

  test("each vital has at least one (kind, expression) pair that buffs (positive effect)", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const vital of ALL_VITALS) {
      let found = false;
      outer: for (const kind of ALL_AFFINITY_KINDS) {
        for (const expr of ALL_EXPRESSIONS) {
          if ((call(getAffinityVitalEffectBase, kind, expr, vital) as number) > 0) {
            found = true;
            break outer;
          }
        }
      }
      expect(found, `vital ${vital} must have at least one buffing pair`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Matrix conforms to expected per-cell values (exhaustive ground truth)
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: exhaustive ground-truth verification", () => {
  test("every cell matches the polarity-driven expectedBase()", async () => {
    const { getAffinityVitalEffectBase } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    const mismatches: string[] = [];
    for (const kind of ALL_AFFINITY_KINDS) {
      for (const expr of ALL_EXPRESSIONS) {
        for (const vital of ALL_VITALS) {
          const actual = call(getAffinityVitalEffectBase, kind, expr, vital) as number;
          const expected = expectedBase(kind, expr, vital);
          if (actual !== expected) {
            mismatches.push(`(kind=${kind}, expr=${expr}, vital=${vital}): expected ${expected}, got ${actual}`);
          }
        }
      }
    }
    expect(mismatches, `matrix has ${mismatches.length} mismatched cells:\n${mismatches.slice(0, 5).join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stack scaling helpers
// ---------------------------------------------------------------------------

describe("affinity-vital matrix: stack scaling (linear for this milestone)", () => {
  test("scaleAffinityVitalEffect(base, stacks) returns base * stacks for positive stacks", async () => {
    const { scaleAffinityVitalEffect } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    expect(call(scaleAffinityVitalEffect, 2, 1)).toBe(2);
    expect(call(scaleAffinityVitalEffect, 2, 3)).toBe(6);
    expect(call(scaleAffinityVitalEffect, 1, 5)).toBe(5);
    expect(call(scaleAffinityVitalEffect, -2, 4)).toBe(-8);
  });

  test("scaleAffinityVitalEffect with stacks=0 returns 0", async () => {
    const { scaleAffinityVitalEffect } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    expect(call(scaleAffinityVitalEffect, 2, 0)).toBe(0);
    expect(call(scaleAffinityVitalEffect, -2, 0)).toBe(0);
  });

  test("scaleAffinityVitalEffect with base=0 always returns 0 regardless of stacks", async () => {
    const { scaleAffinityVitalEffect } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    expect(call(scaleAffinityVitalEffect, 0, 0)).toBe(0);
    expect(call(scaleAffinityVitalEffect, 0, 5)).toBe(0);
    expect(call(scaleAffinityVitalEffect, 0, 100)).toBe(0);
  });

  test("scaleAffinityVitalEffect rejects negative stacks (returns 0)", async () => {
    const { scaleAffinityVitalEffect } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    expect(call(scaleAffinityVitalEffect, 2, -1)).toBe(0);
    expect(call(scaleAffinityVitalEffect, 2, -5)).toBe(0);
  });

  test("getAffinityVitalEffect is the composition: scale(getBase(...), stacks)", async () => {
    const { getAffinityVitalEffect, getAffinityVitalEffectBase, scaleAffinityVitalEffect } = await import(
      "../../packages/core-ts/src/state/affinity.ts"
    );
    for (const kind of ALL_AFFINITY_KINDS) {
      for (const expr of ALL_EXPRESSIONS) {
        for (const vital of ALL_VITALS) {
          for (const stacks of [0, 1, 2, 5]) {
            const composed = call(scaleAffinityVitalEffect, call(getAffinityVitalEffectBase, kind, expr, vital), stacks);
            const direct = call(getAffinityVitalEffect, kind, expr, vital, stacks);
            expect(direct).toBe(composed);
          }
        }
      }
    }
  });
});

// ## TODO: Test Permutations
//
// 1. getAffinityVitalEffect across all 10 affinities × 4 expressions × 4 vitals × stacks ∈ {1, 2, 3, 5, 10}
//    — assert no integer overflow within INT32 bounds
// 2. Sign-reversal property holds at every stack count (push(s) = -pull(s) for all valid s, same vital)
// 3. Polarity invariant: for each affinity, the SET of (expression, vital) cells with sign matches the affinity's polarity
//    table exactly (push/emit share sign, pull/draw share opposite sign)
// 4. Opposite-affinity pairs (Fire↔Water, Earth↔Wind, Life↔Decay, Corrode↔Fortify, Light↔Dark) produce
//    matrix entries with opposite polarities on their shared/related primary vital where applicable
// 5. scaleAffinityVitalEffect with extremely large stacks (e.g. 1_000_000) does not throw and returns a finite integer
// 6. Calling getAffinityVitalEffectBase twice with the same args is referentially transparent (no hidden state)
// 7. Helpers are not exposed via createCore() unless an api-surface test explicitly approves the addition
//    (M3 may add them to CORE_API_KEYS — until then, they live only on the affinity.ts module)
