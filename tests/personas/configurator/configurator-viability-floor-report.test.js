// A loaded level's delvers and wardens below ACTOR_VIABILITY_FLOOR are reported, never raised.
const assert = require("node:assert/strict");

async function report(initialState) {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  return createConfiguratorPersona({ clock: () => "2026-10-13T00:00:00.000Z" })
    .authorCandidates.reportActorViabilityFloor(initialState);
}
const vital = (max, regen) => ({ current: max, max, regen });
const strong = { health: vital(10, 1), mana: vital(10, 1), durability: vital(10, 1) };

test("reports each delver or warden vital below the floor, and leaves the level untouched", async () => {
  const initialState = {
    actors: [
      { id: "delver_1", vitals: { ...strong, mana: vital(4, 1) } },
      { id: "warden_1", vitals: { health: vital(10, 0), mana: vital(10, 1) } },
    ],
    presentation: { delver_1: { category: "delver" }, warden_1: { category: "warden" } },
  };
  const before = JSON.stringify(initialState);
  assert.deepEqual(await report(initialState), [
    { actorId: "delver_1", vital: "mana", field: "max", value: 4, floor: 10 },
    { actorId: "warden_1", vital: "health", field: "regen", value: 0, floor: 1 },
    { actorId: "warden_1", vital: "durability", field: "max", value: 0, floor: 10 },
    { actorId: "warden_1", vital: "durability", field: "regen", value: 0, floor: 1 },
  ]);
  assert.equal(JSON.stringify(initialState), before);
});

test("hazards, resources and barriers are not held to the actor floor", async () => {
  const initialState = {
    actors: ["hazard_1", "resource_1", "barrier_1"].map((id) => ({ id, vitals: { durability: vital(1, 0) } })),
    presentation: { hazard_1: { category: "hazard" }, resource_1: { category: "resource" }, barrier_1: { category: "barrier" } },
  };
  assert.deepEqual(await report(initialState), []);
  assert.deepEqual(await report(undefined), []);
});

// ## TODO: Test Permutations
// - a floor vital given as a non-number (string, null) counts as 0
// - an actor with no presentation entry is skipped
