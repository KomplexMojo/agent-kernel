/**
 * RB2.2 — Configurator-owned strategic and legacy actor placement.
 */
"use strict";

const assert = require("node:assert/strict");

async function configurator() {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/persona.js"
  );
  return createConfiguratorPersona({ clock: () => "2026-08-31T00:00:00.000Z" });
}

test("placeActors owns role inference, affinity preference, occupancy, and authored order", async () => {
  const persona = await configurator();
  const kinds = Array.from({ length: 5 }, () => Array(8).fill(0));
  kinds[0][0] = 1; // spawn portal wall
  kinds[4][7] = 1; // exit portal wall
  const layout = {
    kinds,
    spawn: { x: 0, y: 0 },
    exit: { x: 7, y: 4 },
    spawnApproach: { x: 1, y: 0 },
    exitApproach: { x: 6, y: 4 },
    entryRoomId: "R1",
    exitRoomId: "R2",
    rooms: [
      { id: "R1", x: 0, y: 0, width: 3, height: 2 },
      { id: "R2", x: 5, y: 3, width: 3, height: 2 },
      { id: "R3", x: 3, y: 1, width: 2, height: 3 },
    ],
    hazards: [
      {
        id: "water_hazard",
        x: 3,
        y: 1,
        affinity: { kind: "water", expression: "emit", stacks: 1 },
      },
    ],
    resources: [{ id: "reserved_resource", x: 3, y: 2 }],
  };
  const actors = [
    { id: "guard_water", motivations: ["defending"], affinity: "water" },
    { id: "mystery_actor" },
    { id: "raider_alpha", motivations: ["attacking"] },
  ];
  const original = structuredClone({ actors, layout });

  const result = persona.placeActors({ actors, layout, delverCount: 2 });

  assert.deepEqual(result, {
    actors: [
      {
        id: "guard_water",
        motivations: ["defending"],
        affinity: "water",
        position: { x: 6, y: 4 },
      },
      { id: "mystery_actor", position: { x: 2, y: 0 } },
      { id: "raider_alpha", motivations: ["attacking"], position: { x: 1, y: 0 } },
    ],
    changed: true,
  });
  assert.deepEqual({ actors, layout }, original, "placement does not mutate caller-owned inputs");
});

test("placeActors preserves the legacy power groups and distant-anchor fallback", async () => {
  const persona = await configurator();
  const layout = {
    kinds: Array.from({ length: 3 }, () => Array(4).fill(0)),
    spawn: { x: 0, y: 0 },
    exit: { x: 3, y: 2 },
  };
  const actors = [
    { id: "support_3" },
    { id: "boss_9" },
    { id: "support_1" },
    { id: "captain_7" },
    { id: "support_2" },
  ];

  assert.deepEqual(persona.placeActors({ actors, layout }), {
    actors: [
      { id: "support_3", position: { x: 2, y: 0 } },
      { id: "boss_9", position: { x: 1, y: 0 } },
      { id: "support_1", position: { x: 0, y: 1 } },
      { id: "captain_7", position: { x: 3, y: 1 } },
      { id: "support_2", position: { x: 2, y: 2 } },
    ],
    changed: true,
  });
});

// ## TODO: Test Permutations
// - conflicting delver and warden keywords preserve the current delver-first classification
// - an already-correct actor list returns changed=false without aliasing its position objects
