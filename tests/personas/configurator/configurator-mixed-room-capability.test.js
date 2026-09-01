/**
 * RB2.1 — the Configurator owns mixed-room profile assignment and affinity-hazard synthesis.
 */
"use strict";

const assert = require("node:assert/strict");

function inputLayout() {
  return {
    rooms: [
      { id: "R1", x: 0, y: 0, width: 2, height: 2 },
      { id: "R2", x: 3, y: 0, width: 2, height: 2 },
    ],
    spawn: { x: 0, y: 0 },
    exit: { x: 4, y: 1 },
    hazards: [{ id: "existing", x: 1, y: 0, blocking: false }],
  };
}

const CARD_SET = Object.freeze([
  {
    id: "R-FIRE",
    type: "room",
    count: 1,
    affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
  },
  {
    id: "R-WATER",
    source: "room",
    count: 1,
    affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
  },
]);

test("composeMixedRooms deterministically assigns room profiles and authors affinity hazards", async () => {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/persona.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => "fixed" });
  const original = inputLayout();
  const result = configurator.composeMixedRooms({
    layout: original,
    cardSet: CARD_SET,
    fallbackAffinity: "earth",
    seed: 41,
  });

  assert.deepEqual(original, inputLayout(), "the pure capability must not mutate caller-owned layout data");
  assert.equal(result.generatedHazardCount, 2);
  assert.deepEqual(result.layout.rooms, [
    {
      id: "R1", x: 0, y: 0, width: 2, height: 2,
      templateId: "R-WATER", templateInstanceId: "R-WATER-1",
    },
    {
      id: "R2", x: 3, y: 0, width: 2, height: 2,
      templateId: "R-FIRE", templateInstanceId: "R-FIRE-1",
    },
  ]);
  assert.deepEqual(result.layout.hazards, [
    { id: "existing", x: 1, y: 0, blocking: false },
    {
      id: "fire_emit_1",
      x: 3,
      y: 0,
      blocking: false,
      source: "room_affinity_tile",
      roomId: "R2",
      affinity: { kind: "fire", expression: "emit", stacks: 2, targetType: "floor" },
      vitals: {
        mana: { current: 12, max: 12, regen: 4 },
        durability: { current: 10, max: 10, regen: 0 },
      },
    },
    {
      id: "water_emit_0",
      x: 0,
      y: 1,
      blocking: false,
      source: "room_affinity_tile",
      roomId: "R1",
      affinity: { kind: "water", expression: "emit", stacks: 1, targetType: "floor" },
      vitals: {
        mana: { current: 9, max: 9, regen: 3 },
        durability: { current: 5, max: 5, regen: 0 },
      },
    },
  ]);
});

// ## TODO: Test Permutations
// - ignore non-room cards and room affinities whose expression is not emit
// - preserve existing hazard order while excluding spawn, exit, and occupied cells
