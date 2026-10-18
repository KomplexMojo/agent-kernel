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

test("placeActors uses alignment, affinity preference, occupancy, and authored order", async () => {
  const persona = await configurator();
  const layout = {
    width: 8, height: 5,
    terrain: Array.from({ length: 40 }, (_, index) => index === 0 ? "spawn" : index === 39 ? "exit" : "floor"),
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
    { id: "guard_water", category: "warden", motivations: ["defending"],
      affinities: [{ kind: "water", expression: "emit", stacks: 1 }] },
    { id: "mystery_actor", category: "delver" },
    { id: "raider_alpha", category: "delver", motivations: ["exploring"] },
  ];
  const original = structuredClone({ actors, layout });

  const result = persona.placeActors({ actors, layout, delverCount: 2 });

  assert.deepEqual(result, {
    actors: [
      {
        id: "guard_water",
        category: "warden",
        motivations: ["defending"],
        affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
        // #397: beside the exit approach (6, 4), never on it.
        position: { x: 6, y: 3 },
      },
      { id: "mystery_actor", category: "delver", position: { x: 1, y: 0 } },
      { id: "raider_alpha", category: "delver", motivations: ["exploring"], position: { x: 2, y: 0 } },
    ],
    changed: true,
  });
  assert.deepEqual({ actors, layout }, original, "placement does not mutate caller-owned inputs");
});

test("placeActors preserves the legacy power groups and distant-anchor fallback", async () => {
  const persona = await configurator();
  const layout = {
    width: 4, height: 3,
    terrain: Array.from({ length: 12 }, (_, index) => index === 0 ? "spawn" : index === 11 ? "exit" : "floor"),
    spawnApproach: { x: 1, y: 0 },
    exitApproach: { x: 2, y: 2 },
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
      { id: "support_3", position: { x: 1, y: 1 } },
      { id: "boss_9", position: { x: 1, y: 0 } },
      { id: "support_1", position: { x: 2, y: 0 } },
      { id: "captain_7", position: { x: 3, y: 1 } },
      { id: "support_2", position: { x: 3, y: 0 } },
    ],
    changed: true,
  });
});

// ## TODO: Test Permutations
// - explicit alignment overrides a presentation-category default
// - an already-correct actor list returns changed=false without aliasing its position objects
