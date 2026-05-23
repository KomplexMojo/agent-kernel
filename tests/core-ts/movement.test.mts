import { describe, expect, test } from "vitest";

import { createMoveRules, Direction } from "../../packages/core-ts/src/rules/move.ts";
import { createCore } from "../../packages/core-ts/src/index.ts";

describe("core-ts movement", () => {
  test("setMoveAction stores and decodeMove retrieves the pending action", () => {
    const move = createMoveRules(createWorldStub());

    move.setMoveAction(7, 1, 2, 2, 2, Direction.East, 4);

    expect(move.decodeMove(0)).toEqual({
      actorId: 7,
      fromX: 1,
      fromY: 2,
      toX: 2,
      toY: 2,
      direction: Direction.East,
      tick: 4,
    });
  });

  test("createCore exposes setMoveAction", () => {
    const core = createCore();

    expect(typeof core.setMoveAction).toBe("function");
    expect(() => call(core.setMoveAction, 7, 1, 2, 2, 2, Direction.East, 4)).not.toThrow();
  });

  test("validation and application functions exist on the movement module", () => {
    const move = createMoveRules(createWorldStub());

    expect(typeof move.validateDirection).toBe("function");
    expect(typeof move.validateMoveIdentityAndTiming).toBe("function");
    expect(typeof move.validateMoveGeometryAndDestination).toBe("function");
    expect(typeof move.applyMove).toBe("function");
    expect(typeof move.reachedExitAfterMove).toBe("function");
  });
});

function createWorldStub() {
  return {
    advanceTick: () => undefined,
    getActorId: () => 0,
    getActorMovementCost: () => -1,
    getActorVitalCurrent: () => 0,
    getActorVitalMax: () => 0,
    getActorVitalRegen: () => 0,
    getStaticTrapAffinityAt: () => 0,
    getStaticTrapExpressionAt: () => 0,
    getStaticTrapManaReserveAt: () => 0,
    getStaticTrapStacksAt: () => 0,
    getActorX: () => 0,
    getActorY: () => 0,
    getCurrentTick: () => 0,
    hasActor: () => false,
    hasResourceAt: () => 0,
    getResourceVitalKindAt: () => -1,
    getResourceDeltaAt: () => 0,
    getResourceModeAt: () => 0,
    removeResourceAt: () => undefined,
    isActorAtExit: () => false,
    isMotivatedOccupied: () => false,
    isWalkablePosition: () => false,
    setActorPosition: () => undefined,
    setActorVital: () => undefined,
    withinBounds: () => false,
  };
}

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

// ## TODO: Test Permutations
// - wrong actor, tick mismatch, wrong source position, out-of-bounds destination, blocked wall, and actor collision once world.ts is ported
// - diagonal movement cost with cardinal costs 0, 1, 2, and odd values above 2
// - stamina regeneration before movement cost, including exact-cost and insufficient-stamina boundaries
// - static emit trap damage for all affinity-to-vital mappings
// - consumable, level, and permanent resource capture effects on current and max vital values
