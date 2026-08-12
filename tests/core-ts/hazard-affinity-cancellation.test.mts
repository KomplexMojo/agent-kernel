import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  AffinityExpression,
  AffinityKind,
  AffinityRelationship,
} from "../../packages/core-ts/src/state/affinity.ts";

type Core = ReturnType<typeof createCore>;

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

function setAllFloors(core: Core, width: number, height: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
}

function buildFieldWorld(): Core {
  const core = createCore();
  call(core.configureGrid, 9, 7);
  setAllFloors(core, 9, 7);
  return core;
}

function fieldStacks(core: Core, x: number, y: number, kind: number): number {
  return call(core.getAffinityFieldStacksAt, x, y, kind) as number;
}

function fieldIntensity(core: Core, x: number, y: number, kind: number): number {
  return call(core.getAffinityFieldIntensityAt, x, y, kind) as number;
}

function fieldContribs(core: Core, x: number, y: number, kind: number): number {
  return call(core.getAffinityFieldContributionCountAt, x, y, kind) as number;
}

describe("hazard affinity cancellation", () => {
  test("fire and water remain an opposite affinity relationship", () => {
    const core = createCore();

    expect(call(core.resolveAffinityRelationshipCode, AffinityKind.Fire, AffinityKind.Water))
      .toBe(AffinityRelationship.Opposite);
    expect(call(core.resolveAffinityRelationshipCode, AffinityKind.Water, AffinityKind.Fire))
      .toBe(AffinityRelationship.Opposite);
  });

  test("nearby equal fire and water hazards neutralize overlapping field stacks", () => {
    const core = buildFieldWorld();

    expect(call(core.armStaticHazardAt, 2, 3, AffinityKind.Fire, AffinityExpression.Emit, 3, 5)).toBe(1);
    expect(call(core.armStaticHazardAt, 6, 3, AffinityKind.Water, AffinityExpression.Emit, 3, 5)).toBe(1);
    expect(call(core.computeStaticHazardAffinityField)).toBe(2);

    expect(fieldContribs(core, 4, 3, AffinityKind.Fire)).toBe(1);
    expect(fieldContribs(core, 4, 3, AffinityKind.Water)).toBe(1);
    expect(fieldStacks(core, 4, 3, AffinityKind.Fire)).toBe(0);
    expect(fieldStacks(core, 4, 3, AffinityKind.Water)).toBe(0);
    expect(fieldIntensity(core, 4, 3, AffinityKind.Fire)).toBe(0);
    expect(fieldIntensity(core, 4, 3, AffinityKind.Water)).toBe(0);
  });

  test("unequal opposite hazards leave net stacks on the stronger side", () => {
    const core = buildFieldWorld();

    expect(call(core.armStaticHazardAt, 2, 3, AffinityKind.Fire, AffinityExpression.Emit, 3, 5)).toBe(1);
    expect(call(core.armStaticHazardAt, 6, 3, AffinityKind.Water, AffinityExpression.Emit, 1, 5)).toBe(1);
    call(core.computeStaticHazardAffinityField);

    expect(fieldStacks(core, 4, 3, AffinityKind.Fire)).toBe(2);
    expect(fieldStacks(core, 4, 3, AffinityKind.Water)).toBe(0);
    expect(fieldIntensity(core, 4, 3, AffinityKind.Fire)).toBeGreaterThan(0);
    expect(fieldIntensity(core, 4, 3, AffinityKind.Water)).toBe(0);
  });

  test("combined affinity fields cancel hazard and actor opposite projections", () => {
    const core = buildFieldWorld();

    expect(call(core.armStaticHazardAt, 2, 3, AffinityKind.Fire, AffinityExpression.Emit, 3, 5)).toBe(1);
    call(core.addActorPlacement, 10, 6, 3);
    call(core.applyActorPlacements);
    expect(call(core.setMotivatedActorAffinity, 0, AffinityKind.Water, AffinityExpression.Emit, 3)).toBe(1);

    expect(call(core.computeAffinityField)).toBe(2);
    expect(fieldContribs(core, 4, 3, AffinityKind.Fire)).toBe(1);
    expect(fieldContribs(core, 4, 3, AffinityKind.Water)).toBe(1);
    expect(fieldStacks(core, 4, 3, AffinityKind.Fire)).toBe(0);
    expect(fieldStacks(core, 4, 3, AffinityKind.Water)).toBe(0);
  });
});

// ## TODO: Test Permutations
// - Fire and water hazards with non-overlapping radius should keep independent field stacks.
// - Opposite hazard pairs other than fire/water should cancel with the same net-stack rule.
// - Disabled zero-mana hazards should not contribute to cancellation until mana regenerates.
