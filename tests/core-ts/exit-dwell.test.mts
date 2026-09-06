/**
 * Leaving the level: an actor that sits on the exit tile has EXITED.
 *
 * Maintainer ruling (2026-09-05): two ticks or more on the exit tile means the actor
 * has left, and it stops being part of the actor inventory.
 *
 * WHY THIS IS CORE'S RULE AND NOT THE RUNTIME'S. It is a deterministic state transition
 * over bounded inputs — a position, a counter, a threshold — which is exactly what core
 * owns. The runtime deliberately holds no per-actor state across ticks (persona context
 * must stay serializable), so a counter kept there would be domain logic in glue and
 * would not survive replay.
 *
 * THE DEFECT THIS CLOSES (#169). Before it, an actor that reached the exit stood on it
 * forever: `buildMoveProposal` returns [] when the path length is 1, so it proposed
 * nothing again while its body kept occupying the one tile every other actor was pathing
 * toward. A measured 100-tick run produced 579 `ActorCollision` rejections and three
 * actors that never moved at all. Vacating the exit is not cosmetic — it is what unblocks
 * everyone behind it, so a test drives that through the real move rule rather than
 * inspecting an occupancy flag.
 *
 * Driven entirely through the PUBLIC core surface (`CORE_API_KEYS` + the exported move
 * helpers). An earlier draft reached for `resizeGrid` / `setActorPosition` /
 * `isMotivatedOccupied`, none of which core exposes — the narrow surface is deliberate,
 * and a test that needs internals is testing something the runtime cannot reach either.
 */
import { describe, expect, test } from "vitest";

import { applyMoveAction, createCore, packMoveAction, ValidationError } from "../../packages/core-ts/src/index.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

type Core = ReturnType<typeof createCore>;

const FLOOR = 1;
const EXIT = 3;
const EXIT_AT = { x: 3, y: 1 };

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") throw new Error("expected callable core export");
  return fn(...args);
}

/** Floors across the usable area, with the exit at (3,1). */
function makeWorld(withExit = true): Core {
  const core = createCore();
  // `configureGrid` is what sizes the world AND allocates actor capacity. Without it a
  // fresh core is 0x0 with room for zero actors, and `addActorPlacement` silently
  // overflows — placement then reports success while seating nobody.
  call(core.configureGrid, 6, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 6; x++) call(core.setTileAt, x, y, FLOOR);
  }
  if (withExit) call(core.setTileAt, EXIT_AT.x, EXIT_AT.y, EXIT);
  return core;
}

/**
 * `true` seats on reserved tiles — the exit is one, so placement needs it.
 *
 * Stamina is granted deliberately: core refuses a move with `InsufficientStamina`
 * without it, and the two tests that drive real moves would otherwise be asserting a
 * vitals failure while claiming to measure occupancy.
 */
function seat(core: Core, actors: Array<[id: number, x: number, y: number]>): void {
  call(core.clearActorPlacements);
  for (const [id, x, y] of actors) call(core.addActorPlacement, id, x, y);
  call(core.applyActorPlacements, true);
  for (const [id] of actors) {
    // ⚠️ BY ACTOR ID, NOT INDEX — and it RETURNS an error rather than throwing. Passing
    // an index selects the actor whose id happens to equal it, or silently selects
    // nobody, and `setActorVital` then writes to whoever was already active. That is how
    // a first draft of this file gave actor 0 stamina twice and actor 1 none, and read
    // back as a mysterious `InsufficientStamina` three calls later.
    expect(call(core.setActiveMotivatedActor, id)).toBe(ValidationError.None);
    call(core.setActorVital, VitalKind.Stamina, 8, 8, 8);
  }
}

function activate(core: Core, actorId: number): void {
  expect(call(core.setActiveMotivatedActor, actorId)).toBe(ValidationError.None);
}

/** Core accepts a move stamped for the tick it is ABOUT to apply, i.e. currentTick + 1. */
const nextTick = (core: Core): number => Number(call(core.getCurrentTick)) + 1;

const exited = (core: Core, i: number): boolean => call(core.isMotivatedActorExitedByIndex, i) === true;
const dwell = (core: Core, i: number): number => Number(call(core.getMotivatedActorExitDwellByIndex, i));

describe("core-ts exit dwell", () => {
  test("an actor standing on the exit for two ticks has exited", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_AT.x, EXIT_AT.y]]);
    expect(dwell(core, 0)).toBe(0);
    expect(exited(core, 0)).toBe(false);

    // Tick 1 ENDS with the actor on the exit: one tick there, not two.
    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(1);
    expect(exited(core, 0)).toBe(false);

    // Tick 2 ends with it still there. Two ticks — it has left the level.
    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(2);
    expect(exited(core, 0)).toBe(true);
  });

  test("stepping off the exit before the second tick resets the dwell", () => {
    // CONSECUTIVE ticks. Without the reset an actor could bank a stray tick on the exit
    // early in a run and then leave from somewhere else entirely much later.
    const core = makeWorld();
    seat(core, [[1, EXIT_AT.x, EXIT_AT.y]]);
    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(1);

    activate(core, 1);
    const off = applyMoveAction(core, packMoveAction({
      actorId: 1, from: EXIT_AT, to: { x: 2, y: 1 }, direction: "west", tick: nextTick(core),
    }));
    expect(off).toBe(ValidationError.None);

    call(core.advanceTick);
    expect(dwell(core, 0)).toBe(0);
    expect(exited(core, 0)).toBe(false);
  });

  test("an exited actor releases the exit tile so another actor can take it", () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT #169, and the reason it goes through the real
    // move rule: a rule that flagged the actor without vacating the cell would satisfy
    // every other test here and change nothing whatsoever in a real run.
    const core = makeWorld();
    seat(core, [[1, EXIT_AT.x, EXIT_AT.y], [2, 2, 1]]);

    activate(core, 2);
    const blocked = applyMoveAction(core, packMoveAction({
      actorId: 2, from: { x: 2, y: 1 }, to: EXIT_AT, direction: "east", tick: nextTick(core),
    }));
    expect(blocked).toBe(ValidationError.ActorCollision);

    call(core.advanceTick);
    call(core.advanceTick);
    expect(exited(core, 0)).toBe(true);

    activate(core, 2);
    const allowed = applyMoveAction(core, packMoveAction({
      actorId: 2, from: { x: 2, y: 1 }, to: EXIT_AT, direction: "east", tick: nextTick(core),
    }));
    expect(allowed).toBe(ValidationError.None);
  });

  test("an exited actor stays exited and stops accumulating dwell", () => {
    const core = makeWorld();
    seat(core, [[1, EXIT_AT.x, EXIT_AT.y]]);
    call(core.advanceTick);
    call(core.advanceTick);
    expect(exited(core, 0)).toBe(true);
    const settled = dwell(core, 0);

    call(core.advanceTick);
    call(core.advanceTick);
    expect(exited(core, 0)).toBe(true);
    expect(dwell(core, 0)).toBe(settled);
  });

  test("an actor that never reaches the exit never exits", () => {
    // Anti-vacuity: a rule that simply retired everyone on tick 2 would pass the rest.
    const core = makeWorld();
    seat(core, [[1, 1, 1]]);
    for (let i = 0; i < 10; i++) call(core.advanceTick);
    expect(exited(core, 0)).toBe(false);
    expect(dwell(core, 0)).toBe(0);
  });

  test("a world with no exit tile never exits anyone", () => {
    const core = makeWorld(false);
    seat(core, [[1, 1, 1]]);
    for (let i = 0; i < 5; i++) call(core.advanceTick);
    expect(exited(core, 0)).toBe(false);
  });
});

// ## TODO: Test Permutations
// - two actors reaching the exit on consecutive ticks
// - an actor exiting while a hazard occupies an adjacent tile
