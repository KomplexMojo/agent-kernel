/**
 * Leaving the level: an actor that sits on the exit *approach* has EXITED.
 *
 * Maintainer ruling (2026-09-05): two ticks or more on the exit approach means the actor
 * has left, and it stops being part of the actor inventory.
 *
 * Exit/Spawn tiles are wall portals (non-walkable). Dwell is measured on the single
 * interior floor cell adjacent to the exit portal. Wardens are exit-ineligible.
 *
 * Driven entirely through the PUBLIC core surface.
 */
import { describe, expect, test } from "vitest";

import { applyMoveAction, createCore, packMoveAction, ValidationError } from "../../packages/core-ts/src/index.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

type Core = ReturnType<typeof createCore>;

const FLOOR = 1;
const EXIT = 3;
/** Wall portal cell — non-walkable. */
const EXIT_PORTAL = { x: 4, y: 1 };
/** Interior approach where dwell is measured. */
const EXIT_APPROACH = { x: 3, y: 1 };

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") throw new Error("expected callable core export");
  return fn(...args);
}

function makeWorld(withExit = true): Core {
  const core = createCore();
  call(core.configureGrid, 6, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 6; x++) call(core.setTileAt, x, y, FLOOR);
  }
  if (withExit) {
    call(core.setTileAt, EXIT_PORTAL.x, EXIT_PORTAL.y, EXIT);
    call(core.setExitApproachPosition, EXIT_APPROACH.x, EXIT_APPROACH.y);
  }
  return core;
}

function seat(core: Core, actors: Array<[id: number, x: number, y: number]>): void {
  call(core.clearActorPlacements);
  for (const [id, x, y] of actors) call(core.addActorPlacement, id, x, y);
  call(core.applyActorPlacements, true);
  for (const [id] of actors) {
    expect(call(core.setActiveMotivatedActor, id)).toBe(ValidationError.None);
    call(core.setActorVital, VitalKind.Stamina, 8, 8, 8);
  }
}

function activate(core: Core, actorId: number): void {
  expect(call(core.setActiveMotivatedActor, actorId)).toBe(ValidationError.None);
}

const nextTick = (core: Core): number => Number(call(core.getCurrentTick)) + 1;

const exited = (core: Core, i: number): boolean => call(core.isMotivatedActorExitedByIndex, i) === true;
const dwell = (core: Core, i: number): number => Number(call(core.getMotivatedActorExitDwellByIndex, i));

describe("core-ts exit dwell", () => {
  test("an actor standing on the exit approach for two ticks has exited", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_APPROACH.x, EXIT_APPROACH.y]]);
    expect(dwell(core, 0)).toBe(0);
    expect(exited(core, 0)).toBe(false);

    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(1);
    expect(exited(core, 0)).toBe(false);

    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(2);
    expect(exited(core, 0)).toBe(true);
  });

  test("stepping off the exit approach before the second tick resets the dwell", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_APPROACH.x, EXIT_APPROACH.y]]);
    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(1);

    activate(core, 1);
    const off = applyMoveAction(core, packMoveAction({
      actorId: 1, from: EXIT_APPROACH, to: { x: 2, y: 1 }, direction: "west", tick: nextTick(core),
    }));
    expect(off).toBe(ValidationError.None);

    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(0);
    expect(exited(core, 0)).toBe(false);
  });

  test("an exited actor releases the approach tile so another actor can take it", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_APPROACH.x, EXIT_APPROACH.y], [2, 2, 1]]);

    activate(core, 2);
    const blocked = applyMoveAction(core, packMoveAction({
      actorId: 2, from: { x: 2, y: 1 }, to: EXIT_APPROACH, direction: "east", tick: nextTick(core),
    }));
    expect(blocked).toBe(ValidationError.ActorCollision);

    call(core.advanceTick);
    call(core.advanceTick);
    expect(exited(core, 0)).toBe(true);

    activate(core, 2);
    const allowed = applyMoveAction(core, packMoveAction({
      actorId: 2, from: { x: 2, y: 1 }, to: EXIT_APPROACH, direction: "east", tick: nextTick(core),
    }));
    expect(allowed).toBe(ValidationError.None);
  });

  test("an exited actor stays exited and stops accumulating dwell", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_APPROACH.x, EXIT_APPROACH.y]]);
    call(core.advanceTick);
    call(core.advanceTick);
    expect(exited(core, 0)).toBe(true);
    const settled = dwell(core, 0);

    call(core.advanceTick);
    call(core.advanceTick);
    expect(exited(core, 0)).toBe(true);
    expect(dwell(core, 0)).toBe(settled);
  });

  test("an actor that never reaches the exit approach never exits", () => {
    const core = makeWorld();
    seat(core, [[1, 1, 1]]);
    for (let i = 0; i < 10; i++) call(core.advanceTick);
    expect(exited(core, 0)).toBe(false);
    expect(dwell(core, 0)).toBe(0);
  });

  test("a world with no exit approach never exits anyone", () => {
    const core = makeWorld(false);
    seat(core, [[1, 1, 1]]);
    for (let i = 0; i < 5; i++) call(core.advanceTick);
    expect(exited(core, 0)).toBe(false);
  });

  test("exit-ineligible actors never exit even after dwelling on the approach", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_APPROACH.x, EXIT_APPROACH.y]]);
    call(core.setMotivatedActorExitEligible, 0, 0);
    expect(call(core.isMotivatedActorExitEligible, 0)).toBe(false);

    call(core.advanceTick);
    call(core.advanceTick);
    call(core.advanceTick);
    expect(exited(core, 0)).toBe(false);
    expect(dwell(core, 0)).toBe(0);
  });

  test("actors cannot walk onto the exit portal tile", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_APPROACH.x, EXIT_APPROACH.y]]);
    activate(core, 1);
    const blocked = applyMoveAction(core, packMoveAction({
      actorId: 1,
      from: EXIT_APPROACH,
      to: EXIT_PORTAL,
      direction: "east",
      tick: nextTick(core),
    }));
    expect(blocked).toBe(ValidationError.BlockedByWall);
  });
});

// ## TODO: Test Permutations
// - two actors reaching the exit approach on consecutive ticks
// - an actor exiting while a hazard occupies an adjacent tile
