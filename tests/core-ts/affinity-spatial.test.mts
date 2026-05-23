import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  AffinityExpression,
  AffinityKind,
  AffinityRelationship,
} from "../../packages/core-ts/src/state/affinity.ts";

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
});

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

// ## TODO: Test Permutations
// - every matrix cell returns the same source effect, target effect, visual state, and cancel flag as core-as
// - resolveAffinityInteraction rejects invalid kind, expression, and stack combinations without mutating prior last-result state
// - resolveMotivatedActorAffinityInteraction reads both actor slots and rejects missing affinity data
// - computeAffinityIntensity handles negative distance and zero stacks with the AssemblyScript clamp behavior
// - stack cancellation clamps source and target stacks below 1 before computing net stacks
