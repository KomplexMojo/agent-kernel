import { describe, expect, test } from "vitest";

import {
  AFFINITY_EFFECT_BY_CODE,
  AFFINITY_EXPRESSION_BY_CODE,
  AFFINITY_KIND_BY_CODE,
  AFFINITY_RELATIONSHIP_BY_CODE,
  AFFINITY_VISUAL_STATE_BY_CODE,
  readAffinityFieldAt,
} from "../../packages/core-ts/src/affinity-readers.ts";
import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  AffinityExpression,
  AffinityKind,
  AffinityRelationship,
  AffinityTargetType,
} from "../../packages/core-ts/src/state/affinity.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

describe("core-ts affinity codebook", () => {
  test("reports affinity codebook counts", () => {
    const core = createCore();

    expect(call(core.getAffinityKindCount)).toBe(10);
    expect(call(core.getAffinityExpressionCount)).toBe(4);
    expect(call(core.getAffinityTargetTypeCount)).toBe(6);
  });

  test("resolves all opposite affinity pairs bidirectionally", () => {
    const core = createCore();
    const pairs = [
      [AffinityKind.Fire, AffinityKind.Water],
      [AffinityKind.Earth, AffinityKind.Wind],
      [AffinityKind.Life, AffinityKind.Decay],
      [AffinityKind.Corrode, AffinityKind.Fortify],
      [AffinityKind.Light, AffinityKind.Dark],
    ];

    for (const [left, right] of pairs) {
      expect(call(core.getOppositeAffinityKind, left)).toBe(right);
      expect(call(core.getOppositeAffinityKind, right)).toBe(left);
    }
  });

  test("returns sentinel for invalid opposite affinity lookups", () => {
    const core = createCore();

    expect(call(core.getOppositeAffinityKind, 0)).toBe(0);
    expect(call(core.getOppositeAffinityKind, 11)).toBe(0);
  });

  test("resolves same, opposite, neutral, and invalid relationships", () => {
    const core = createCore();

    expect(call(core.resolveAffinityRelationshipCode, AffinityKind.Fire, AffinityKind.Fire)).toBe(
      AffinityRelationship.Same,
    );
    expect(call(core.resolveAffinityRelationshipCode, AffinityKind.Fire, AffinityKind.Water)).toBe(
      AffinityRelationship.Opposite,
    );
    expect(call(core.resolveAffinityRelationshipCode, AffinityKind.Fire, AffinityKind.Earth)).toBe(
      AffinityRelationship.Neutral,
    );
    expect(call(core.resolveAffinityRelationshipCode, 0, AffinityKind.Fire)).toBe(-1);
  });

  test("maps affinity kinds to target vitals", () => {
    const core = createCore();

    expect(call(core.getAffinityTargetVital, AffinityKind.Fire)).toBe(
      VitalKind.Health,
    );
    expect(call(core.getAffinityTargetVital, AffinityKind.Earth)).toBe(
      VitalKind.Stamina,
    );
    expect(call(core.getAffinityTargetVital, AffinityKind.Corrode)).toBe(
      VitalKind.Durability,
    );
    expect(call(core.getAffinityTargetVital, AffinityKind.Light)).toBe(
      VitalKind.Mana,
    );
  });

  test("maps affinity expressions to default target types", () => {
    const core = createCore();

    expect(call(core.getDefaultAffinityTargetType, AffinityExpression.Push)).toBe(
      AffinityTargetType.Enemy,
    );
    expect(call(core.getDefaultAffinityTargetType, AffinityExpression.Pull)).toBe(
      AffinityTargetType.Self,
    );
    expect(call(core.getDefaultAffinityTargetType, AffinityExpression.Emit)).toBe(
      AffinityTargetType.Area,
    );
    expect(call(core.getDefaultAffinityTargetType, AffinityExpression.Draw)).toBe(
      AffinityTargetType.Self,
    );
  });

  test("reports affinity expression profile flags", () => {
    const core = createCore();

    expect(call(core.affinityExpressionAllowsEnvironmentMutation, AffinityExpression.Push)).toBe(
      true,
    );
    expect(call(core.affinityExpressionAllowsEnvironmentMutation, AffinityExpression.Pull)).toBe(
      true,
    );
    expect(call(core.affinityExpressionAllowsEnvironmentMutation, AffinityExpression.Emit)).toBe(
      true,
    );
    expect(call(core.affinityExpressionAllowsEnvironmentMutation, AffinityExpression.Draw)).toBe(
      false,
    );
    expect(call(core.affinityExpressionAllowsTrapArming, AffinityExpression.Push)).toBe(
      true,
    );
    expect(call(core.affinityExpressionAllowsTrapArming, AffinityExpression.Draw)).toBe(
      false,
    );
    expect(call(core.affinityExpressionIsPersistentField, AffinityExpression.Push)).toBe(
      false,
    );
    expect(call(core.affinityExpressionIsPersistentField, AffinityExpression.Pull)).toBe(
      false,
    );
    expect(call(core.affinityExpressionIsPersistentField, AffinityExpression.Emit)).toBe(
      true,
    );
    expect(call(core.affinityExpressionIsPersistentField, AffinityExpression.Draw)).toBe(
      true,
    );
  });

  test("exports reader code maps", () => {
    expect(AFFINITY_KIND_BY_CODE[AffinityKind.Fire]).toBe("fire");
    expect(AFFINITY_EXPRESSION_BY_CODE[AffinityExpression.Emit]).toBe("emit");
    expect(AFFINITY_RELATIONSHIP_BY_CODE[AffinityRelationship.Opposite]).toBe(
      "opposite",
    );
    expect(AFFINITY_EFFECT_BY_CODE[6]).toBe("amplified_damage");
    expect(AFFINITY_VISUAL_STATE_BY_CODE[21]).toBe("emit_field");
  });

  test("reads affinity field data from a core-compatible object", () => {
    const field = readAffinityFieldAt(
      {
        getAffinityFieldIntensityAt: (x, y, kind) => x + y + kind,
        getAffinityFieldStacksAt: () => 3,
        getAffinityFieldExpressionAt: () => AffinityExpression.Emit,
        getAffinityFieldContributionCountAt: () => 2,
      },
      4,
      5,
      AffinityKind.Fire,
    );

    expect(field).toEqual({
      intensity: 10,
      stacks: 3,
      expression: AffinityExpression.Emit,
      expressionName: "emit",
      contributionCount: 2,
    });
  });
});

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

describe("core-ts affinity codebook permutations", () => {
  test("invalid affinity kinds return sentinel vital", () => {
    const core = createCore();
    expect(call(core.getAffinityTargetVital, 0)).toBe(-1);
    expect(call(core.getAffinityTargetVital, 11)).toBe(-1);
    expect(call(core.getAffinityTargetVital, -1)).toBe(-1);
  });

  test("invalid affinity expressions return false flags", () => {
    const core = createCore();
    expect(call(core.affinityExpressionAllowsEnvironmentMutation, 0)).toBe(false);
    expect(call(core.affinityExpressionAllowsEnvironmentMutation, 5)).toBe(false);
    expect(call(core.affinityExpressionAllowsTrapArming, 0)).toBe(false);
    expect(call(core.affinityExpressionIsPersistentField, 0)).toBe(false);
  });

  test("every affinity kind maps to the expected vital", () => {
    const core = createCore();
    const expected: Array<[number, number]> = [
      [AffinityKind.Fire, VitalKind.Health],
      [AffinityKind.Water, VitalKind.Health],
      [AffinityKind.Earth, VitalKind.Stamina],
      [AffinityKind.Wind, VitalKind.Stamina],
      [AffinityKind.Life, VitalKind.Health],
      [AffinityKind.Decay, VitalKind.Health],
      [AffinityKind.Corrode, VitalKind.Durability],
      [AffinityKind.Fortify, VitalKind.Durability],
      [AffinityKind.Light, VitalKind.Mana],
      [AffinityKind.Dark, VitalKind.Mana],
    ];
    for (const [kind, vital] of expected) {
      expect(call(core.getAffinityTargetVital, kind)).toBe(vital);
    }
  });

  test("reader utilities return undefined for unmapped codes", () => {
    expect(AFFINITY_KIND_BY_CODE[0]).toBeUndefined();
    expect(AFFINITY_EXPRESSION_BY_CODE[0]).toBeUndefined();
  });
});
