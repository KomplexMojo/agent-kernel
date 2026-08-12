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

  test("armStaticHazardAt and hazard getters", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 2, 2, 1); // Floor

    expect(call(core.armStaticHazardAt, 2, 2, 1, 3, 2, 100)).toBe(1);
    expect(call(core.getStaticHazardAffinityAt, 2, 2)).toBe(1);
    expect(call(core.getStaticHazardExpressionAt, 2, 2)).toBe(3);
    expect(call(core.getStaticHazardStacksAt, 2, 2)).toBe(2);
    expect(call(core.getStaticHazardManaReserveAt, 2, 2)).toBe(100);
    expect(call(core.getStaticHazardCount)).toBe(1);
  });

  test("disarmStaticHazardAt clears hazard", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 2, 2, 1);
    call(core.armStaticHazardAt, 2, 2, 1, 3, 2, 100);

    expect(call(core.disarmStaticHazardAt, 2, 2)).toBe(1);
    expect(call(core.getStaticHazardAffinityAt, 2, 2)).toBe(0);
    expect(call(core.getStaticHazardCount)).toBe(0);
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

// Affinity field projection, computeActorAffinityField, and computeAffinityField
// are covered in affinity-actor-field.test.mts and affinity-environment-effects.test.mts.

describe("core-ts world state permutations", () => {
  test("loadMvpBarrierScenario produces expected barrier tile layout", () => {
    const core = createCore();
    call(core.loadMvpBarrierScenario);

    expect(call(core.getMapWidth)).toBe(9);
    expect(call(core.getMapHeight)).toBe(9);
    // Corners are walls (#)
    expect(call(core.renderBaseCellChar, 0, 0)).toBe(35); // '#'
    // Interior floor tiles
    expect(call(core.renderBaseCellChar, 1, 1)).toBe(83); // 'S' (spawn)
    // Actor should be at spawn
    expect(call(core.getActorX)).toBe(1);
    expect(call(core.getActorY)).toBe(1);
  });

  test("motivated actor vital set/get with multiple actors and switching", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 1);
    call(core.setTileAt, 3, 3, 1);
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 1, 1);
    call(core.addActorPlacement, 20, 3, 3);
    call(core.applyActorPlacements);

    // Set all 4 vitals for actor 0
    call(core.setMotivatedActorVital, 0, 0, 100, 100, 5); // Health
    call(core.setMotivatedActorVital, 0, 1, 50, 50, 2);   // Mana
    call(core.setMotivatedActorVital, 0, 2, 30, 30, 1);   // Stamina
    call(core.setMotivatedActorVital, 0, 3, 10, 10, 0);   // Durability

    // Set different vitals for actor 1
    call(core.setMotivatedActorVital, 1, 0, 200, 200, 10);
    call(core.setMotivatedActorVital, 1, 1, 80, 80, 3);
    call(core.setMotivatedActorVital, 1, 2, 40, 40, 2);
    call(core.setMotivatedActorVital, 1, 3, 20, 20, 0);

    // Switch to actor 20 and verify
    call(core.setActiveMotivatedActor, 20);
    expect(call(core.getActorHp)).toBe(200);
    expect(call(core.getActorMaxHp)).toBe(200);
    expect(call(core.getActorVitalCurrent, 1)).toBe(80);
    expect(call(core.getActorVitalCurrent, 2)).toBe(40);

    // Switch back to actor 10
    call(core.setActiveMotivatedActor, 10);
    expect(call(core.getActorHp)).toBe(100);
    expect(call(core.getActorVitalCurrent, 1)).toBe(50);
  });

  test("actor capability setters mirror to motivated arrays", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 1);
    call(core.setTileAt, 3, 3, 1);
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 1, 1);
    call(core.addActorPlacement, 20, 3, 3);
    call(core.applyActorPlacements);

    // Set capabilities for actor 0
    call(core.setActorMovementCost, 3);
    call(core.setActorActionCostMana, 5);
    call(core.setActorActionCostStamina, 2);

    expect(call(core.getActorMovementCost)).toBe(3);
    expect(call(core.getActorActionCostMana)).toBe(5);
    expect(call(core.getActorActionCostStamina)).toBe(2);

    // Verify motivated actor array was updated
    expect(call(core.getMotivatedActorMovementCostByIndex, 0)).toBe(3);
    expect(call(core.getMotivatedActorActionCostManaByIndex, 0)).toBe(5);
    expect(call(core.getMotivatedActorActionCostStaminaByIndex, 0)).toBe(2);

    // Actor 1 should still have defaults
    expect(call(core.getMotivatedActorMovementCostByIndex, 1)).toBe(1);
  });

  test("validateActorPlacement rejects wall tiles and duplicate positions", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 1); // Floor
    // (0,0) remains wall

    // Placement on wall should fail validation
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 0, 0);
    const wallResult = call(core.applyActorPlacements);
    expect(wallResult).not.toBe(0);

    // Duplicate positions
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 1, 1);
    call(core.addActorPlacement, 20, 1, 1);
    const dupResult = call(core.applyActorPlacements);
    expect(dupResult).not.toBe(0);
  });

  test("regen skips durability vital kind", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 2);
    call(core.spawnActorAt, 1, 1);

    // Set all 4 vitals with regen
    call(core.setActorVital, 0, 5, 10, 2);  // Health: 5/10, regen 2
    call(core.setActorVital, 1, 3, 10, 1);  // Mana: 3/10, regen 1
    call(core.setActorVital, 2, 4, 10, 1);  // Stamina: 4/10, regen 1
    call(core.setActorVital, 3, 1, 10, 5);  // Durability: 1/10, regen 5

    call(core.advanceTick);

    expect(call(core.getActorVitalCurrent, 0)).toBe(7);  // 5 + 2
    expect(call(core.getActorVitalCurrent, 1)).toBe(4);  // 3 + 1
    expect(call(core.getActorVitalCurrent, 2)).toBe(5);  // 4 + 1
    expect(call(core.getActorVitalCurrent, 3)).toBe(1);  // Durability: NO regen
  });

  test("barrier durability defaults to 3", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 2, 2, 1); // Floor

    call(core.raiseBarrierAt, 2, 2);
    expect(call(core.getTileActorDurability, 2, 2)).toBe(3);
  });

  test("regen does not exceed max vital", () => {
    const core = createCore();
    call(core.configureGrid, 5, 5);
    call(core.setTileAt, 1, 1, 2);
    call(core.spawnActorAt, 1, 1);

    call(core.setActorVital, 0, 9, 10, 5); // Health: 9/10, regen 5

    call(core.advanceTick);

    // Should clamp to max (10), not overflow to 14
    expect(call(core.getActorVitalCurrent, 0)).toBe(10);
  });
});
