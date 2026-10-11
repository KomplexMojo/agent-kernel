/**
 * Every affinity has a mana cost (maintainer, 2026-10-11): "When the mana for
 * the light affinity is drained, the actor has to wait until their mana is
 * regenerated. This is true for everything."
 *
 * Persistent expressions (emit, draw) pay a per-turn upkeep; push and pull pay
 * per use, which casts already charge. Core charges the upkeep at tick close
 * from a table the runtime supplies (the amount is Configurator data). A source
 * that cannot pay is EXHAUSTED: its affinity is off (no field, no light, no
 * damage) until its mana has regenerated to full.
 */
import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";

const LIGHT = 9;
const FIRE = 1;
const PUSH = 1;
const EMIT = 3;
const MANA = 1;

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") throw new Error("expected callable core export");
  return fn(...args);
}

function floorCore(w: number, h: number) {
  const core = createCore();
  call(core.configureGrid, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) call(core.setTileAt, x, y, 1);
  // Upkeep 2 + stacks, as the Configurator authors it; index 0 is unused.
  call(core.setPersistentAffinityUpkeepTable, [0, 3, 4, 5, 6, 7]);
  return core;
}

describe("static hazard upkeep", () => {
  test("an emitting hazard pays its upkeep every tick", () => {
    const core = floorCore(5, 3);
    call(core.armStaticHazardAt, 2, 1, LIGHT, EMIT, 2, 12, 0, 0, 0, 12, 0);
    call(core.advanceTick);
    expect(call(core.getStaticHazardManaReserveAt, 2, 1)).toBe(8);
  });

  test("a hazard that cannot pay goes dark and waits for a full refill", () => {
    const core = floorCore(5, 3);
    // Pool 6, regen 2, upkeep 4: pays tick 1 (6 -> 2, +2 regen = 4), pays tick 2
    // (4 -> 0, +2 = 2), cannot pay tick 3 and is exhausted.
    call(core.armStaticHazardAt, 2, 1, LIGHT, EMIT, 2, 6, 0, 0, 0, 6, 2);
    call(core.advanceTick);
    call(core.advanceTick);
    expect(call(core.isStaticHazardExhaustedAt, 2, 1)).toBe(0);
    call(core.advanceTick);
    expect(call(core.isStaticHazardExhaustedAt, 2, 1)).toBe(1);
    expect((call(core.readLightLevels) as number[]).every((level) => level === 0)).toBe(true);
    call(core.computeAffinityField);
    expect(call(core.getAffinityFieldStacksAt, 2, 1, LIGHT)).toBe(0);

    // Mana 4 after tick 3. It does not relight at 4 or 6-but-paying: it waits for full.
    call(core.advanceTick);
    expect(call(core.getStaticHazardManaReserveAt, 2, 1)).toBe(6);
    expect(call(core.isStaticHazardExhaustedAt, 2, 1)).toBe(0);
    expect((call(core.readLightLevels) as number[]).some((level) => level > 0)).toBe(true);
  });

  test("a hazard whose regen covers its upkeep never goes dark", () => {
    const core = floorCore(5, 3);
    call(core.armStaticHazardAt, 2, 1, LIGHT, EMIT, 2, 12, 0, 0, 0, 12, 4);
    for (let t = 0; t < 10; t++) call(core.advanceTick);
    expect(call(core.getStaticHazardManaReserveAt, 2, 1)).toBe(12);
    expect(call(core.isStaticHazardExhaustedAt, 2, 1)).toBe(0);
  });

  test("push and pull pay per use, not per turn", () => {
    const core = floorCore(5, 3);
    call(core.armStaticHazardAt, 2, 1, FIRE, PUSH, 2, 10, 0, 0, 0, 10, 0);
    call(core.advanceTick);
    expect(call(core.getStaticHazardManaReserveAt, 2, 1)).toBe(10);
  });

  test("with no upkeep table, nothing is charged", () => {
    const core = createCore();
    call(core.configureGrid, 5, 3);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) call(core.setTileAt, x, y, 1);
    call(core.armStaticHazardAt, 2, 1, LIGHT, EMIT, 2, 6, 0, 0, 0, 6, 0);
    call(core.advanceTick);
    expect(call(core.getStaticHazardManaReserveAt, 2, 1)).toBe(6);
  });

  test("stacks beyond the table pay the table's last entry", () => {
    const core = floorCore(5, 3);
    call(core.armStaticHazardAt, 2, 1, LIGHT, EMIT, 9, 20, 0, 0, 0, 20, 0);
    call(core.advanceTick);
    expect(call(core.getStaticHazardManaReserveAt, 2, 1)).toBe(13);
  });
});

describe("actor affinity upkeep", () => {
  function actorCore() {
    const core = floorCore(9, 3);
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 4, 1);
    call(core.applyActorPlacements);
    call(core.setMotivatedActorAffinity, 0, LIGHT, EMIT, 2);
    return core;
  }

  test("an actor emitting light pays the upkeep from its mana", () => {
    const core = actorCore();
    call(core.setMotivatedActorVital, 0, MANA, 10, 10, 1);
    call(core.advanceTick);
    // 10 - 4 upkeep + 1 regen.
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 0, MANA)).toBe(7);
  });

  test("a drained actor's light goes out until its mana is full again", () => {
    const core = actorCore();
    call(core.setMotivatedActorVital, 0, MANA, 5, 6, 3);
    call(core.advanceTick); // pays 4: 5 -> 1, +3 = 4
    call(core.advanceTick); // pays 4: 4 -> 0, +3 = 3
    call(core.advanceTick); // cannot pay 4 at 3: exhausted, +3 = 6 = full
    expect(call(core.isMotivatedActorAffinityExhaustedByIndex, 0)).toBe(0);

    call(core.setMotivatedActorVital, 0, MANA, 3, 12, 1);
    call(core.advanceTick); // cannot pay: exhausted, +1 = 4
    expect(call(core.isMotivatedActorAffinityExhaustedByIndex, 0)).toBe(1);
    expect(call(core.getVisibilityRadiusForActorIndex, 0)).toBe(1);
    expect((call(core.readLightLevels) as number[]).every((level) => level === 0)).toBe(true);
    call(core.computeAffinityField);
    expect(call(core.getAffinityFieldStacksAt, 4, 1, LIGHT)).toBe(0);
    // While exhausted it pays nothing and only regenerates.
    call(core.advanceTick);
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 0, MANA)).toBe(5);
  });

  test("changing an actor's affinity clears the wait", () => {
    const core = actorCore();
    call(core.setMotivatedActorVital, 0, MANA, 1, 12, 0);
    call(core.advanceTick);
    expect(call(core.isMotivatedActorAffinityExhaustedByIndex, 0)).toBe(1);
    call(core.setMotivatedActorAffinity, 0, LIGHT, EMIT, 1);
    expect(call(core.isMotivatedActorAffinityExhaustedByIndex, 0)).toBe(0);
  });
});

// ## TODO: Test Permutations
//
// - draw expression pays upkeep exactly like emit
// - a dark-on-emit hazard that is exhausted no longer cancels light
// - an exhausted emit hazard deals no step damage (rules/move.ts)
// - re-arming an exhausted hazard clears the wait
// - several actors exhaust independently
