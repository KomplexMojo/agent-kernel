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

describe("core-ts barriers and static traps", () => {
  test("raises/destroys barriers and arms/disarms static traps", () => {
    const core = createCore();
    call(core.configureGrid, 4, 4);
    setAllFloors(core, 4, 4);

    // Set tile to barrier (tile code 4)
    call(core.setTileAt, 1, 1, 4);
    expect(call(core.getTileActorKind, 1, 1)).toBe(1); // Barrier kind
    expect(call(core.destroyBarrierAt, 1, 1)).toBe(1);
    expect(call(core.getTileActorKind, 1, 1)).toBe(0);
    expect(call(core.raiseBarrierAt, 1, 1)).toBe(1);
    expect(call(core.getTileActorKind, 1, 1)).toBe(1); // Barrier kind

    expect(call(core.armStaticTrapAt, 2, 2, 1, 1, 2, 5)).toBe(1);
    expect(call(core.getStaticTrapCount)).toBe(1);
    expect(call(core.getStaticTrapAffinityAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapExpressionAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapStacksAt, 2, 2)).toBe(2);
    expect(call(core.getStaticTrapManaReserveAt, 2, 2)).toBe(5);

    // Traps only arm on floor tiles — barrier tile should fail
    expect(call(core.armStaticTrapAt, 1, 1, 2, 3, 3, 4)).toBe(0);
    expect(call(core.getStaticTrapCount)).toBe(1);

    expect(call(core.disarmStaticTrapAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapCount)).toBe(0);
  });
});

describe("core-ts affinity field buffers", () => {
  test("clearAffinityField zeros all field arrays", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    // Arm a trap and compute so fields are populated
    call(core.armStaticTrapAt, 2, 2, FIRE, EMIT, 1, 5);
    call(core.computeStaticTrapAffinityField);
    expect(call(core.getAffinityFieldIntensityAt, 2, 2, FIRE)).toBe(1.0);

    // Clear and verify zeros
    call(core.clearAffinityField);
    expect(call(core.getAffinityFieldIntensityAt, 2, 2, FIRE)).toBe(0.0);
    expect(call(core.getAffinityFieldStacksAt, 2, 2, FIRE)).toBe(0);
    expect(call(core.getAffinityFieldExpressionAt, 2, 2, FIRE)).toBe(0);
    expect(call(core.getAffinityFieldContributionCountAt, 2, 2, FIRE)).toBe(0);
  });

  test("computeStaticTrapAffinityField: fire emit stacks=1 on 5x5 grid", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    // Fire emit at (2,2), stacks=1, mana=5
    // emit stacks=1: radius = floor(1.0 + 1.0 * 1) = 2
    call(core.armStaticTrapAt, 2, 2, FIRE, EMIT, 1, 5);
    const projected = call(core.computeStaticTrapAffinityField);
    expect(projected).toBe(1);

    // Source tile (d=0): intensity 1.0
    expect(call(core.getAffinityFieldIntensityAt, 2, 2, FIRE)).toBe(1.0);
    expect(call(core.getAffinityFieldStacksAt, 2, 2, FIRE)).toBe(1);
    expect(call(core.getAffinityFieldExpressionAt, 2, 2, FIRE)).toBe(EMIT);
    expect(call(core.getAffinityFieldContributionCountAt, 2, 2, FIRE)).toBe(1);

    // d=1 cells: emit buffer zone -> intensity 0.0
    expect(call(core.getAffinityFieldIntensityAt, 1, 2, FIRE)).toBe(0.0);
    expect(call(core.getAffinityFieldIntensityAt, 3, 2, FIRE)).toBe(0.0);
    expect(call(core.getAffinityFieldIntensityAt, 2, 1, FIRE)).toBe(0.0);
    expect(call(core.getAffinityFieldIntensityAt, 2, 3, FIRE)).toBe(0.0);

    // d=2 cells: intensity = 1.0 * 1^0.3 * (1 - 0.5) = 0.5
    expect(call(core.getAffinityFieldIntensityAt, 0, 2, FIRE)).toBeCloseTo(0.5, 10);
    expect(call(core.getAffinityFieldIntensityAt, 4, 2, FIRE)).toBeCloseTo(0.5, 10);
    // Diagonal d=2: (1,1), (3,3), etc.
    expect(call(core.getAffinityFieldIntensityAt, 1, 1, FIRE)).toBeCloseTo(0.5, 10);

    // d=3+ cells: beyond radius=2 -> intensity 0.0
    expect(call(core.getAffinityFieldIntensityAt, 0, 0, FIRE)).toBe(0.0);

    // No water (kind=2) contribution anywhere
    expect(call(core.getAffinityFieldIntensityAt, 2, 2, 2)).toBe(0.0);
  });

  test("per-kind channels: fire and water traps produce independent fields", () => {
    const core = createCore();
    const FIRE = 1, WATER = 2, EMIT = 3;
    call(core.configureGrid, 9, 5);
    setAllFloors(core, 9, 5);

    // Fire emit at (1,2), water emit at (7,2), both stacks=1 (radius=2)
    // Far enough apart that fields don't overlap (distance=6 > 2*radius=4)
    call(core.armStaticTrapAt, 1, 2, FIRE, EMIT, 1, 5);
    call(core.armStaticTrapAt, 7, 2, WATER, EMIT, 1, 5);
    call(core.computeStaticTrapAffinityField);

    // (1,2) is source for fire only
    expect(call(core.getAffinityFieldIntensityAt, 1, 2, FIRE)).toBe(1.0);
    expect(call(core.getAffinityFieldIntensityAt, 1, 2, WATER)).toBe(0.0);

    // (7,2) is source for water only
    expect(call(core.getAffinityFieldIntensityAt, 7, 2, WATER)).toBe(1.0);
    expect(call(core.getAffinityFieldIntensityAt, 7, 2, FIRE)).toBe(0.0);

    // Contribution counts are independent
    expect(call(core.getAffinityFieldContributionCountAt, 1, 2, FIRE)).toBe(1);
    expect(call(core.getAffinityFieldContributionCountAt, 7, 2, WATER)).toBe(1);

    // Verify fire spreads but water doesn't reach fire's area
    const fireD2 = call(core.getAffinityFieldIntensityAt, 3, 2, FIRE) as number;
    expect(fireD2).toBeGreaterThan(0);
    expect(call(core.getAffinityFieldIntensityAt, 3, 2, WATER)).toBe(0.0);
  });

  test("same-kind overlap uses max intensity", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 7, 5);
    setAllFloors(core, 7, 5);

    // Two fire emit traps: (1,2) stacks=1 and (5,2) stacks=2
    call(core.armStaticTrapAt, 1, 2, FIRE, EMIT, 1, 5);
    call(core.armStaticTrapAt, 5, 2, FIRE, EMIT, 2, 5);
    call(core.computeStaticTrapAffinityField);

    // (3,2) is d=2 from trap1 (within radius=2) and d=2 from trap2 (within radius=3)
    // trap1 intensity at d=2: 0.5
    // trap2 intensity at d=2 stacks=2: higher
    // max wins
    const fieldIntensity = call(core.getAffinityFieldIntensityAt, 3, 2, FIRE) as number;
    expect(fieldIntensity).toBeGreaterThan(0.5);

    // Contribution count should be 2
    expect(call(core.getAffinityFieldContributionCountAt, 3, 2, FIRE)).toBe(2);

    // Stacks should be from the higher-intensity trap (stacks=2)
    expect(call(core.getAffinityFieldStacksAt, 3, 2, FIRE)).toBe(2);
  });

  test("field getters return 0 for out-of-bounds and invalid kind", () => {
    const core = createCore();
    call(core.configureGrid, 3, 3);
    setAllFloors(core, 3, 3);

    // Out of bounds
    expect(call(core.getAffinityFieldIntensityAt, -1, 0, 1)).toBe(0.0);
    expect(call(core.getAffinityFieldIntensityAt, 0, 5, 1)).toBe(0.0);
    expect(call(core.getAffinityFieldIntensityAt, 3, 0, 1)).toBe(0.0);

    // Invalid kind (0 and 11)
    expect(call(core.getAffinityFieldIntensityAt, 0, 0, 0)).toBe(0.0);
    expect(call(core.getAffinityFieldIntensityAt, 0, 0, 11)).toBe(0.0);
    expect(call(core.getAffinityFieldStacksAt, 0, 0, 0)).toBe(0);
    expect(call(core.getAffinityFieldExpressionAt, 0, 0, 0)).toBe(0);
    expect(call(core.getAffinityFieldContributionCountAt, 0, 0, 0)).toBe(0);
  });

  test("configureGrid resizes and clears field buffers", () => {
    const core = createCore();
    const FIRE = 1, EMIT = 3;
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);
    call(core.armStaticTrapAt, 2, 2, FIRE, EMIT, 1, 5);
    call(core.computeStaticTrapAffinityField);
    expect(call(core.getAffinityFieldIntensityAt, 2, 2, FIRE)).toBe(1.0);

    // Reconfigure to smaller grid — fields must be zeroed
    call(core.configureGrid, 3, 3);
    setAllFloors(core, 3, 3);
    expect(call(core.getAffinityFieldIntensityAt, 1, 1, FIRE)).toBe(0.0);
    expect(call(core.getAffinityFieldContributionCountAt, 1, 1, FIRE)).toBe(0);
  });

  test("computeStaticTrapAffinityField returns trap count", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    setAllFloors(core, 5, 5);

    // No traps -> returns 0
    expect(call(core.computeStaticTrapAffinityField)).toBe(0);

    // Two traps -> returns 2
    call(core.armStaticTrapAt, 1, 1, 1, 3, 1, 5);
    call(core.armStaticTrapAt, 3, 3, 2, 3, 1, 5);
    expect(call(core.computeStaticTrapAffinityField)).toBe(2);
  });

  test("existing trap behavior unchanged after field addition", () => {
    const core = createCore();
    call(core.configureGrid, 4, 4);
    setAllFloors(core, 4, 4);

    expect(call(core.armStaticTrapAt, 2, 2, 1, 1, 2, 5)).toBe(1);
    expect(call(core.getStaticTrapCount)).toBe(1);
    expect(call(core.getStaticTrapAffinityAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapExpressionAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapStacksAt, 2, 2)).toBe(2);
    expect(call(core.getStaticTrapManaReserveAt, 2, 2)).toBe(5);
    expect(call(core.disarmStaticTrapAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapCount)).toBe(0);
  });
});

// ## TODO: Test Permutations
// - Field spread: all 4 expressions x stacks 1..5 verify correct radius and intensity pattern
// - Manhattan distance correctness: verify cells at exact boundary (d=radius) get intensity 0 or near-0
// - All 10 affinity kinds: arm one trap of each kind, compute, verify kind isolation
// - Overlapping same-kind: 3+ traps overlapping, verify max-intensity selection across all overlap cells
// - Mixed expression overlap: fire push + fire emit on adjacent cells, verify expression recorded correctly
// - Large grid stress: 20x20 grid with 10 traps, verify no abort and correct field shape
// - Non-floor tiles block traps: wall/barrier cells cannot arm traps (existing behavior preserved)
// - Disarm then recompute: arm trap, compute, disarm trap, recompute, verify field is cleared
// - Zero stacks or zero mana traps rejected: armStaticTrapAt returns 0 for invalid params
