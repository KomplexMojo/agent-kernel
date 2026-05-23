import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

function setAllFloors(core: ReturnType<typeof createCore>, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
}

function placeActor(
  core: ReturnType<typeof createCore>,
  id: number,
  x: number,
  y: number,
): void {
  call(core.clearActorPlacements);
  call(core.addActorPlacement, id, x, y);
  call(core.applyActorPlacements);
}

function placeActors(
  core: ReturnType<typeof createCore>,
  actors: Array<[id: number, x: number, y: number]>,
): void {
  call(core.clearActorPlacements);
  for (const [id, x, y] of actors) {
    call(core.addActorPlacement, id, x, y);
  }
  call(core.applyActorPlacements);
}

describe("core-ts actor affinity storage", () => {
  test("setMotivatedActorAffinity stores and reads back affinity data", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    placeActors(core, [
      [10, 2, 2],
      [20, 4, 4],
    ]);

    // Default affinity should be zero
    expect(call(core.getMotivatedActorAffinityKindByIndex, 0)).toBe(0);
    expect(call(core.getMotivatedActorAffinityExpressionByIndex, 0)).toBe(0);
    expect(call(core.getMotivatedActorAffinityStacksByIndex, 0)).toBe(0);

    // Set actor 0 affinity: fire emit stacks=2
    expect(call(core.setMotivatedActorAffinity, 0, FIRE, EMIT, 2)).toBe(1);
    expect(call(core.getMotivatedActorAffinityKindByIndex, 0)).toBe(FIRE);
    expect(call(core.getMotivatedActorAffinityExpressionByIndex, 0)).toBe(EMIT);
    expect(call(core.getMotivatedActorAffinityStacksByIndex, 0)).toBe(2);

    // Actor 1 still default
    expect(call(core.getMotivatedActorAffinityKindByIndex, 1)).toBe(0);
  });

  test("setMotivatedActorAffinity rejects invalid inputs", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);
    placeActor(core, 10, 2, 2);

    // Invalid actor index
    expect(call(core.setMotivatedActorAffinity, -1, 1, 3, 1)).toBe(0);
    expect(call(core.setMotivatedActorAffinity, 1, 1, 3, 1)).toBe(0); // only 1 actor

    // Invalid affinity kind
    expect(call(core.setMotivatedActorAffinity, 0, 0, 3, 1)).toBe(0);
    expect(call(core.setMotivatedActorAffinity, 0, 11, 3, 1)).toBe(0);

    // Invalid expression
    expect(call(core.setMotivatedActorAffinity, 0, 1, 0, 1)).toBe(0);
    expect(call(core.setMotivatedActorAffinity, 0, 1, 5, 1)).toBe(0);

    // Invalid stacks
    expect(call(core.setMotivatedActorAffinity, 0, 1, 3, 0)).toBe(0);
    expect(call(core.setMotivatedActorAffinity, 0, 1, 3, -1)).toBe(0);
  });

  test("actor affinity getters return 0 for invalid indices", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    // No actors placed
    expect(call(core.getMotivatedActorAffinityKindByIndex, 0)).toBe(0);
    expect(call(core.getMotivatedActorAffinityExpressionByIndex, -1)).toBe(0);
    expect(call(core.getMotivatedActorAffinityStacksByIndex, 100)).toBe(0);
  });
});

describe("core-ts actor affinity field projection", () => {
  test("computeActorAffinityField projects fire emit onto surrounding tiles", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 7, 7);
    setAllFloors(core, 7, 7);

    placeActor(core, 10, 3, 3);
    call(core.setMotivatedActorAffinity, 0, FIRE, EMIT, 1);

    const count = call(core.computeActorAffinityField);
    expect(count).toBe(1);

    // Source tile: intensity 1.0
    expect(call(core.getAffinityFieldIntensityAt, 3, 3, FIRE)).toBe(1.0);
    expect(call(core.getAffinityFieldStacksAt, 3, 3, FIRE)).toBe(1);
    expect(call(core.getAffinityFieldExpressionAt, 3, 3, FIRE)).toBe(EMIT);

    // emit stacks=1: radius = floor(1.0 + 1.0 * 1) = 2
    // d=1: emit buffer zone -> intensity 0.0
    expect(call(core.getAffinityFieldIntensityAt, 2, 3, FIRE)).toBe(0.0);

    // d=2: intensity = 1.0 * 1^0.3 * (1 - 0.5) = 0.5
    expect(call(core.getAffinityFieldIntensityAt, 1, 3, FIRE)).toBeCloseTo(0.5, 10);

    // d=3: beyond radius=2 -> intensity 0.0
    expect(call(core.getAffinityFieldIntensityAt, 0, 3, FIRE)).toBe(0.0);
  });

  test("stacks=2 extends range", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 9, 9);
    setAllFloors(core, 9, 9);

    placeActor(core, 10, 4, 4);
    call(core.setMotivatedActorAffinity, 0, FIRE, EMIT, 2);

    call(core.computeActorAffinityField);

    // emit stacks=2: radius = floor(1.0 + 1.0 * 2) = 3
    expect(call(core.getAffinityFieldIntensityAt, 4, 4, FIRE)).toBe(1.0);

    // d=3 should have some intensity (within radius=3)
    const d3Intensity = call(core.getAffinityFieldIntensityAt, 1, 4, FIRE) as number;
    expect(d3Intensity).toBeGreaterThan(0);

    // d=4 should be 0 (beyond radius=3)
    expect(call(core.getAffinityFieldIntensityAt, 0, 4, FIRE)).toBe(0.0);
  });

  test("skips actors without affinity", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    placeActor(core, 10, 2, 2);

    const count = call(core.computeActorAffinityField);
    expect(count).toBe(0);
    expect(call(core.getAffinityFieldIntensityAt, 2, 2, 1)).toBe(0.0);
  });

  test("two actors with different affinities produce independent channels", () => {
    const core = createCore();
    const FIRE = 1, WATER = 2, EMIT = 3;
    call(core.configureGrid, 11, 5);
    setAllFloors(core, 11, 5);

    placeActors(core, [
      [10, 1, 2],
      [20, 9, 2],
    ]);
    call(core.setMotivatedActorAffinity, 0, FIRE, EMIT, 1);
    call(core.setMotivatedActorAffinity, 1, WATER, EMIT, 1);

    const count = call(core.computeActorAffinityField);
    expect(count).toBe(2);

    // Fire at actor 0 source
    expect(call(core.getAffinityFieldIntensityAt, 1, 2, FIRE)).toBe(1.0);
    expect(call(core.getAffinityFieldIntensityAt, 1, 2, WATER)).toBe(0.0);

    // Water at actor 1 source
    expect(call(core.getAffinityFieldIntensityAt, 9, 2, WATER)).toBe(1.0);
    expect(call(core.getAffinityFieldIntensityAt, 9, 2, FIRE)).toBe(0.0);
  });
});

describe("core-ts combined field (computeAffinityField)", () => {
  test("combines traps and actors", () => {
    const core = createCore();
    const FIRE = 1, WATER = 2, EMIT = 3;
    call(core.configureGrid, 11, 5);
    setAllFloors(core, 11, 5);

    // Fire trap at (1,2) stacks=1
    call(core.armStaticTrapAt, 1, 2, FIRE, EMIT, 1, 5);

    // Water actor at (9,2) stacks=1
    placeActor(core, 10, 9, 2);
    call(core.setMotivatedActorAffinity, 0, WATER, EMIT, 1);

    const total = call(core.computeAffinityField);
    expect(total).toBe(2);

    // Fire from trap
    expect(call(core.getAffinityFieldIntensityAt, 1, 2, FIRE)).toBe(1.0);
    // Water from actor
    expect(call(core.getAffinityFieldIntensityAt, 9, 2, WATER)).toBe(1.0);
  });

  test("same-kind overlap between trap and actor uses max", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 7, 5);
    setAllFloors(core, 7, 5);

    // Fire trap at (1,2) stacks=1 (radius=2)
    call(core.armStaticTrapAt, 1, 2, FIRE, EMIT, 1, 5);

    // Fire actor at (5,2) stacks=2 (radius=3)
    placeActor(core, 10, 5, 2);
    call(core.setMotivatedActorAffinity, 0, FIRE, EMIT, 2);

    call(core.computeAffinityField);

    // (3,2): d=2 from trap (within radius=2), d=2 from actor (within radius=3)
    const overlap = call(core.getAffinityFieldIntensityAt, 3, 2, FIRE) as number;
    expect(overlap).toBeGreaterThan(0.5);

    // Contribution count = 2 (both trap and actor)
    expect(call(core.getAffinityFieldContributionCountAt, 3, 2, FIRE)).toBe(2);
  });
});

describe("core-ts actor affinity lifecycle", () => {
  test("actor affinity survives applyActorPlacements", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    placeActor(core, 10, 2, 2);
    call(core.setMotivatedActorAffinity, 0, FIRE, EMIT, 2);

    // Re-apply placements (same actor, same position)
    placeActor(core, 10, 2, 2);

    // Affinity should still be set
    expect(call(core.getMotivatedActorAffinityKindByIndex, 0)).toBe(FIRE);
    expect(call(core.getMotivatedActorAffinityExpressionByIndex, 0)).toBe(EMIT);
    expect(call(core.getMotivatedActorAffinityStacksByIndex, 0)).toBe(2);
  });

  test("configureGrid clears actor affinities", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    placeActor(core, 10, 2, 2);
    call(core.setMotivatedActorAffinity, 0, FIRE, EMIT, 2);

    // Reconfigure grid — everything should reset
    call(core.configureGrid, 3, 3);
    setAllFloors(core, 3, 3);
    placeActor(core, 10, 1, 1);

    expect(call(core.getMotivatedActorAffinityKindByIndex, 0)).toBe(0);
  });
});

// ## TODO: Test Permutations
// - All 10 affinity kinds: set actor affinity for each kind, compute field, verify kind isolation
// - All 4 expressions: set actor affinity for each expression, verify radius and intensity pattern
// - Stacks 1..5: verify radius scales correctly for each stack count
// - Multiple actors same kind: two actors same affinity kind, verify max-intensity overlap
// - Actor at grid edge: actor at (0,0) with stacks=2, verify no out-of-bounds
// - Large grid stress: 20x20 grid with 10 actors each with affinity, verify no abort
// - Mixed trap+actor same cell: trap and actor on same tile, verify combined contribution count
// - Actor moves then recompute: move actor, recompute field, verify field follows actor position
// - Clear actor affinity: set affinity then overwrite with different kind, verify old kind cleared
// - computeAffinityField returns correct total when some actors lack affinity
