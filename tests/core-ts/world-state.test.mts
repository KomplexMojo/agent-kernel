import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";

describe("core-ts world state", () => {
  test("configureGrid sets width and height", () => {
    const core = createCore();

    call(core.configureGrid, 10, 8);

    expect(call(core.getMapWidth)).toBe(10);
    expect(call(core.getMapHeight)).toBe(8);
  });

  test("configureGrid rejects invalid dimensions", () => {
    const core = createCore();

    expect(call(core.configureGrid, 0, 5)).not.toBe(0);
    expect(call(core.configureGrid, -1, 5)).not.toBe(0);
  });

  test("setTileAt and renderBaseCellChar produce correct characters", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);

    call(core.setTileAt, 1, 1, 1); // Floor
    call(core.setTileAt, 2, 1, 2); // Spawn
    call(core.setTileAt, 3, 1, 3); // Exit

    expect(call(core.renderBaseCellChar, 0, 0)).toBe(35); // '#' (wall)
    expect(call(core.renderBaseCellChar, 1, 1)).toBe(46); // '.' (floor)
    expect(call(core.renderBaseCellChar, 2, 1)).toBe(83); // 'S' (spawn)
    expect(call(core.renderBaseCellChar, 3, 1)).toBe(69); // 'E' (exit)
  });

  test("spawnActorAt places actor and renderCellChar shows @", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 2); // Spawn
    call(core.spawnActorAt, 1, 1);

    expect(call(core.getActorX)).toBe(1);
    expect(call(core.getActorY)).toBe(1);
    expect(call(core.renderCellChar, 1, 1)).toBe(64); // '@'
  });

  test("loadMvpScenario creates a 9x9 grid with actor", () => {
    const core = createCore();
    call(core.loadMvpScenario);

    expect(call(core.getMapWidth)).toBe(9);
    expect(call(core.getMapHeight)).toBe(9);
    expect(call(core.getActorX)).toBe(1);
    expect(call(core.getActorY)).toBe(1);
    expect(call(core.getCurrentTick)).toBe(0);
  });

  test("setActorVital and getActorVital roundtrip", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 2);
    call(core.spawnActorAt, 1, 1);

    call(core.setActorVital, 0, 10, 20, 1); // Health
    call(core.setActorVital, 2, 5, 15, 2); // Stamina

    expect(call(core.getActorVitalCurrent, 0)).toBe(10);
    expect(call(core.getActorVitalMax, 0)).toBe(20);
    expect(call(core.getActorVitalRegen, 0)).toBe(1);
    expect(call(core.getActorVitalCurrent, 2)).toBe(5);
    expect(call(core.getActorHp)).toBe(10);
    expect(call(core.getActorMaxHp)).toBe(20);
  });

  test("advanceTick increments tick and applies regen", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 2);
    call(core.spawnActorAt, 1, 1);
    call(core.setActorVital, 0, 8, 10, 1); // Health: 8/10, regen 1

    call(core.advanceTick);

    expect(call(core.getCurrentTick)).toBe(1);
    expect(call(core.getActorVitalCurrent, 0)).toBe(9); // 8 + 1 regen
  });

  test("armStaticTrapAt and trap getters", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 2, 2, 1); // Floor

    expect(call(core.armStaticTrapAt, 2, 2, 1, 3, 2, 100)).toBe(1);
    expect(call(core.getStaticTrapAffinityAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapExpressionAt, 2, 2)).toBe(3);
    expect(call(core.getStaticTrapStacksAt, 2, 2)).toBe(2);
    expect(call(core.getStaticTrapManaReserveAt, 2, 2)).toBe(100);
    expect(call(core.getStaticTrapCount)).toBe(1);
  });

  test("disarmStaticTrapAt clears trap", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 2, 2, 1);
    call(core.armStaticTrapAt, 2, 2, 1, 3, 2, 100);

    expect(call(core.disarmStaticTrapAt, 2, 2)).toBe(1);
    expect(call(core.getStaticTrapAffinityAt, 2, 2)).toBe(0);
    expect(call(core.getStaticTrapCount)).toBe(0);
  });

  test("raiseBarrierAt and destroyBarrierAt", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 2, 2, 1); // Floor

    expect(call(core.raiseBarrierAt, 2, 2)).toBe(1);
    expect(call(core.renderBaseCellChar, 2, 2)).toBe(66); // 'B'
    expect(call(core.destroyBarrierAt, 2, 2)).toBe(1);
    expect(call(core.renderBaseCellChar, 2, 2)).toBe(46); // '.'
  });

  test("addActorPlacement and applyActorPlacements", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 1); // Floor
    call(core.setTileAt, 2, 2, 1); // Floor

    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 1, 1);
    call(core.addActorPlacement, 20, 2, 2);
    expect(call(core.getActorPlacementCount)).toBe(2);

    expect(call(core.applyActorPlacements)).toBe(0); // ValidationError.None
    expect(call(core.getMotivatedActorCount)).toBe(2);
    expect(call(core.getMotivatedActorIdByIndex, 0)).toBe(10);
    expect(call(core.getMotivatedActorXByIndex, 0)).toBe(1);
    expect(call(core.getMotivatedActorYByIndex, 0)).toBe(1);
    expect(call(core.getMotivatedActorIdByIndex, 1)).toBe(20);
  });

  test("setActiveMotivatedActor switches actor mirror", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 1);
    call(core.setTileAt, 3, 3, 1);
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 1, 1);
    call(core.addActorPlacement, 20, 3, 3);
    call(core.applyActorPlacements);

    call(core.setMotivatedActorVital, 0, 0, 50, 50, 0); // actor 10 health
    call(core.setMotivatedActorVital, 1, 0, 30, 30, 0); // actor 20 health

    call(core.setActiveMotivatedActor, 20);
    expect(call(core.getActorId)).toBe(20);
    expect(call(core.getActorX)).toBe(3);
    expect(call(core.getActorY)).toBe(3);
    expect(call(core.getActorHp)).toBe(30);

    call(core.setActiveMotivatedActor, 10);
    expect(call(core.getActorId)).toBe(10);
    expect(call(core.getActorHp)).toBe(50);
  });

  test("tileActorCount matches grid cells", () => {
    const core = createCore();
    call(core.configureGrid, 4, 3);

    expect(call(core.getTileActorCount)).toBe(12);
  });

  test("validateActorVitals checks all 4 vitals are set", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 2);
    call(core.spawnActorAt, 1, 1);

    // Only set health — should fail (missing 3 vitals)
    call(core.setActorVital, 0, 10, 10, 0);
    expect(call(core.validateActorVitals)).not.toBe(0);

    // Set all 4
    call(core.setActorVital, 1, 0, 0, 0); // Mana
    call(core.setActorVital, 2, 5, 10, 0); // Stamina
    call(core.setActorVital, 3, 0, 0, 0); // Durability
    expect(call(core.validateActorVitals)).toBe(0);
  });

  test("separate createCore instances have independent world state", () => {
    const a = createCore();
    const b = createCore();

    call(a.configureGrid, 10, 10);
    call(b.configureGrid, 3, 3);

    expect(call(a.getMapWidth)).toBe(10);
    expect(call(b.getMapWidth)).toBe(3);
  });
});

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

// ## TODO: Test Permutations
// - loadMvpScenario and loadMvpBarrierScenario produce expected tile layout at known coordinates
// - setActorPosition updates both actor mirror and motivated actor arrays
// - motivated actor vital set/get with multiple actors and setActiveMotivatedActor switching
// - actor capability setters (movement cost, mana cost, stamina cost) mirror to motivated arrays
// - validateActorCapabilities rejects negative costs
// - addActorPlacement overflow at maxMotivatedActors
// - validateActorPlacement rejects spawn/exit tiles, wall tiles, and duplicate positions
// - affinity field projection: armStaticTrapAt + computeStaticTrapAffinityField produces expected intensity at known distance
// - computeActorAffinityField projects motivated actor affinities
// - computeAffinityField combines traps and actors
// - regen skips durability vital kind
// - barrier durability defaults to 3
