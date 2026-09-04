import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  AffinityExpression,
  AffinityKind,
  AffinityRelationship,
} from "../../packages/core-ts/src/state/affinity.ts";
import {
  AffinityEffect,
  deriveAffinityInteractionCell,
} from "../../packages/core-ts/src/state/affinity-spatial.ts";

/**
 * The 48-cell oracle. Two SAME-relationship cells changed on 2026-09-04 by maintainer
 * ruling and are marked below: a DRAW converts same-kind energy however it arrives,
 * including a directed push. Both used to be `Damage`, which made the one expression
 * built to absorb its own element the only one punished by it. The visual moved with the
 * effect -- a conversion that still rendered as a Strike would reach players as a bug.
 *
 * Every other cell is unchanged, and that is the point of keeping this table: a
 * derivation edit that quietly moved a third cell would fail here.
 */
const INTERACTION_ORACLE = [
  [1, 1, [0, 0, 1], [2, 2, 2]],
  [1, 2, [0, 0, 3], [1, 1, 4]],
  [1, 3, [0, 0, 21], [3, 3, 5]],
  [1, 4, [0, 4, 11], [0, 6, 7]], // A.2: push -> same-kind draw converts (was [0,1,6])
  [2, 1, [0, 0, 3], [1, 0, 8]],
  [2, 2, [4, 5, 9], [1, 1, 10]],
  [2, 3, [4, 0, 11], [1, 3, 12]],
  [2, 4, [4, 5, 13], [1, 5, 14]],
  [3, 1, [0, 0, 21], [3, 3, 5]],
  [3, 2, [0, 4, 11], [3, 1, 12]],
  [3, 3, [0, 0, 15], [3, 3, 16]],
  [3, 4, [0, 4, 11], [0, 1, 17]],
  [4, 1, [4, 0, 11], [6, 0, 7]], // A.2: draw absorbs a same-kind push (was [1,0,6])
  [4, 2, [5, 4, 13], [5, 1, 14]],
  [4, 3, [4, 0, 11], [1, 0, 17]],
  [4, 4, [0, 0, 18], [1, 1, 19]],
] as const;

describe("core-ts affinity spatial formulas", () => {
  test("computes affinity radius by expression and stacks", () => {
    const core = createCore();

    expect(call(core.computeAffinityRadius, AffinityExpression.Emit, 2)).toBe(3);
    expect(call(core.computeAffinityRadius, AffinityExpression.Push, 1)).toBe(1);
    expect(call(core.computeAffinityRadius, AffinityExpression.Draw, 8)).toBe(1);
  });

  test("computes intensity falloff", () => {
    const core = createCore();

    expect(call(core.computeAffinityIntensity, 1, 2, 0)).toBe(0);
    expect(
      Number(call(core.computeAffinityIntensity, 1, 4, AffinityExpression.Push)),
    ).toBeGreaterThan(
      Number(call(core.computeAffinityIntensity, 2, 4, AffinityExpression.Push)),
    );
    expect(call(core.computeAffinityIntensity, 3, 4, AffinityExpression.Push)).toBe(0);
  });

  test("computes potency by expression", () => {
    const core = createCore();

    expect(call(core.computeAffinityPotency, 2, AffinityExpression.Push)).toBe(4);
    expect(call(core.computeAffinityPotency, 3, AffinityExpression.Pull)).toBe(3);
  });

  test("computes mana costs", () => {
    const core = createCore();

    expect(call(core.computeAffinityManaCost, 2, AffinityExpression.Emit)).toBe(3);
    expect(call(core.computeAffinityManaCost, 2, AffinityExpression.Push)).toBe(0);
  });

  test("resolves stack cancellation with last-result getters", () => {
    const core = createCore();

    expect(call(core.resolveAffinityStackCancellation, 3, 2)).toBe(2);
    expect(call(core.getLastAffinityCanceledStacks)).toBe(2);
    expect(call(core.getLastAffinityNetSourceStacks)).toBe(1);
    expect(call(core.getLastAffinityNetTargetStacks)).toBe(0);
  });

  test("merges stacks with cap", () => {
    const core = createCore();

    expect(call(core.resolveAffinityMergedStacks, 5, 5)).toBe(8);
    expect(call(core.resolveAffinityMergedStacks, 2, 3)).toBe(5);
  });

  test("looks up matrix cells", () => {
    const core = createCore();

    expect(
      call(
        core.getAffinityMatrixSourceEffect,
        AffinityExpression.Push,
        AffinityExpression.Push,
        AffinityRelationship.Same,
      ),
    ).toBe(0);
    expect(
      call(
        core.getAffinityMatrixSourceEffect,
        AffinityExpression.Push,
        AffinityExpression.Push,
        AffinityRelationship.Opposite,
      ),
    ).toBe(2);
  });

  test("resolves interactions and stack cancellation", () => {
    const core = createCore();

    expect(
      call(
        core.resolveAffinityInteraction,
        AffinityKind.Fire,
        AffinityExpression.Push,
        3,
        AffinityKind.Water,
        AffinityExpression.Push,
        2,
      ),
    ).toBe(1);
    expect(call(core.getLastInteractionCanceledStacks)).toBe(2);
    expect(call(core.getLastInteractionNetSourceStacks)).toBe(1);
    expect(call(core.getLastInteractionNetTargetStacks)).toBe(0);
  });

  test("reports matrix codebook counts", () => {
    const core = createCore();

    expect(call(core.getAffinityInteractionCellCount)).toBe(48);
    expect(call(core.getAffinityVisualStateCount)).toBe(21);
    expect(call(core.getAffinityEffectCount)).toBe(7);
  });

  test("preserves the 48-cell v1 interaction compatibility oracle", () => {
    const core = createCore();

    for (const [sourceExpression, targetExpression, same, opposite] of INTERACTION_ORACLE) {
      for (const [relationship, expected] of [
        [AffinityRelationship.Same, same],
        [AffinityRelationship.Opposite, opposite],
        [AffinityRelationship.Neutral, [AffinityEffect.None, AffinityEffect.None, 20]],
      ] as const) {
        expect(deriveAffinityInteractionCell(
          sourceExpression,
          targetExpression,
          relationship,
        )).toEqual({
          sourceEffect: expected[0],
          targetEffect: expected[1],
          visualState: expected[2],
          usesStackCancellation: relationship === AffinityRelationship.Opposite ? 1 : 0,
        });
        expect([
          call(core.getAffinityMatrixSourceEffect, sourceExpression, targetExpression, relationship),
          call(core.getAffinityMatrixTargetEffect, sourceExpression, targetExpression, relationship),
          call(core.getAffinityMatrixVisualState, sourceExpression, targetExpression, relationship),
        ]).toEqual(expected);
        expect(call(
          core.getAffinityMatrixUsesStackCancellation,
          sourceExpression,
          targetExpression,
          relationship,
        )).toBe(relationship === AffinityRelationship.Opposite ? 1 : 0);
      }
    }
  });

  test("derives only valid cells and preserves interaction invariants", () => {
    const validEffects = new Set<number>(Object.values(AffinityEffect));
    for (let sourceExpression = 1; sourceExpression <= 4; sourceExpression += 1) {
      for (let targetExpression = 1; targetExpression <= 4; targetExpression += 1) {
        for (const relationship of [
          AffinityRelationship.Same,
          AffinityRelationship.Opposite,
          AffinityRelationship.Neutral,
        ]) {
          const cell = deriveAffinityInteractionCell(sourceExpression, targetExpression, relationship);
          expect(cell).not.toBeNull();
          expect(validEffects.has(cell!.sourceEffect)).toBe(true);
          expect(validEffects.has(cell!.targetEffect)).toBe(true);
          expect(cell!.visualState).toBeGreaterThanOrEqual(1);
          expect(cell!.visualState).toBeLessThanOrEqual(21);
          expect(cell!.usesStackCancellation).toBe(
            relationship === AffinityRelationship.Opposite ? 1 : 0,
          );
          if (relationship === AffinityRelationship.Neutral) {
            expect(cell).toMatchObject({
              sourceEffect: AffinityEffect.None,
              targetEffect: AffinityEffect.None,
              visualState: 20,
            });
          }
        }
      }
    }
    expect(deriveAffinityInteractionCell(0, 1, AffinityRelationship.Same)).toBeNull();
    expect(deriveAffinityInteractionCell(1, 5, AffinityRelationship.Same)).toBeNull();
    expect(deriveAffinityInteractionCell(1, 1, 3)).toBeNull();
  });
});

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

describe("core-ts affinity spatial permutations", () => {
  test("computeAffinityIntensity handles negative distance gracefully", () => {
    const core = createCore();
    const result = call(core.computeAffinityIntensity, -1, 1, 3);
    expect(typeof result).toBe("number");
  });

  test("computeAffinityIntensity with zero stacks still computes", () => {
    const core = createCore();
    // Zero stacks plugs into the formula — doesn't short-circuit to 0
    const result = call(core.computeAffinityIntensity, 2, 0, 3) as number;
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(0);
  });

  test("computeAffinityRadius for all 4 expressions", () => {
    const core = createCore();
    // Push: radius = floor(1.5 + 0.5 * stacks) — stacks=1→1
    expect(call(core.computeAffinityRadius, AffinityExpression.Push, 1)).toBe(1);
    // Pull: similar formula
    expect(call(core.computeAffinityRadius, AffinityExpression.Pull, 1)).toBe(1);
    // Emit: radius = floor(1.0 + 1.0 * stacks) — stacks=1→2
    expect(call(core.computeAffinityRadius, AffinityExpression.Emit, 1)).toBe(2);
    expect(call(core.computeAffinityRadius, AffinityExpression.Emit, 2)).toBe(3);
    // Draw: radius = floor(0.5 + 0.5 * stacks) — stacks=1→1
    expect(call(core.computeAffinityRadius, AffinityExpression.Draw, 1)).toBe(1);
  });

  test("stack cancellation: Fire vs Water (opposite) cancels stacks", () => {
    const core = createCore();
    // Fire vs Water (opposite): should cancel stacks
    call(core.resolveAffinityStackCancellation, 3, 2, AffinityRelationship.Opposite);
    const canceledStacks = call(core.getLastAffinityCanceledStacks) as number;
    expect(canceledStacks).toBeGreaterThan(0);
    // net source stacks after cancellation
    const netSource = call(core.getLastAffinityNetSourceStacks) as number;
    expect(netSource).toBeGreaterThanOrEqual(1);
  });
});
