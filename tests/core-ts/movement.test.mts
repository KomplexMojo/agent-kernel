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

describe("core-ts movement permutations", () => {
  test("setMoveAction round-trip with all 7 fields", () => {
    const move = createMoveRules(createWorldStub());

    move.setMoveAction(42, 5, 6, 6, 6, Direction.East, 3);
    const decoded = move.decodeMove(0);

    expect(decoded.actorId).toBe(42);
    expect(decoded.fromX).toBe(5);
    expect(decoded.fromY).toBe(6);
    expect(decoded.toX).toBe(6);
    expect(decoded.toY).toBe(6);
    expect(decoded.direction).toBe(Direction.East);
    expect(decoded.tick).toBe(3);
  });

  test("validateDirection rejects direction 8 (out of 0-7 range)", () => {
    const move = createMoveRules(createWorldStub());

    move.setMoveAction(1, 0, 0, 0, 0, 8, 0);
    const decoded = move.decodeMove(0);
    expect(move.validateDirection(decoded)).toBe(false);
  });

  test("validateDirection accepts all 8 cardinal+diagonal directions", () => {
    const move = createMoveRules(createWorldStub());
    // Direction offsets: N(0,-1), NE(1,-1), E(1,0), SE(1,1), S(0,1), SW(-1,1), W(-1,0), NW(-1,-1)
    const offsets: Array<[number, number]> = [
      [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    for (let dir = 0; dir < 8; dir++) {
      const [dx, dy] = offsets[dir];
      move.setMoveAction(1, 3, 3, 3 + dx, 3 + dy, dir, 0);
      const decoded = move.decodeMove(0);
      expect(move.validateDirection(decoded)).toBe(true);
    }
  });
});
