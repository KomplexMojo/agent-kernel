/**
 * #675: the Configurator authors each actor's temperament beside the roster (`temperaments`),
 * from `temperament` on the actor or a `temperaments` map. 0 is the default and is left out;
 * anything but a whole number 0 or more, or an unknown actor, is refused.
 */
"use strict";

const assert = require("node:assert/strict");

const FIXED = "2026-11-08T00:00:00.000Z";
const VITALS = {
  health: { current: 20, max: 20, regen: 1 },
  mana: { current: 20, max: 20, regen: 1 },
  stamina: { current: 20, max: 20, regen: 1 },
  durability: { current: 20, max: 20, regen: 1 },
};
const delver = (id, x, extra = {}) => ({ id, category: "delver", position: { x, y: 1 }, motivations: ["strategy_focused"], vitals: VITALS, ...extra });

async function build(input) {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  return createConfiguratorPersona({ clock: () => FIXED }).buildInitialStateArtifact({
    meta: { id: "s", runId: "s", createdAt: FIXED },
    simConfigRef: { id: "c", schema: "agon/SimConfigArtifact", schemaVersion: 1 },
    dimensions: { width: 6, height: 3 },
    terrain: Array(18).fill("floor"),
    ...input,
  });
}

test("temperament on the actor or in a map rides beside the roster; 0 is left out", async () => {
  const state = await build({ actors: [delver("bold", 1, { temperament: 2 }), delver("calm", 2, { temperament: 0 }), delver("mapped", 3)],
    temperaments: { mapped: 1 } });
  assert.deepEqual(state.temperaments, { bold: 2, mapped: 1 });
  assert.ok(state.actors.every((actor) => actor.temperament === undefined), "never on a core record");
  assert.equal((await build({ actors: [delver("calm", 1)] })).temperaments, undefined);
});

test("refuses a temperament that is not a whole number 0 or more, and an unknown actor", async () => {
  await assert.rejects(build({ actors: [delver("a", 1, { temperament: -1 })] }), /a: temperament must be a whole number/);
  await assert.rejects(build({ actors: [delver("a", 1, { temperament: 1.5 })] }), /temperament must be a whole number/);
  await assert.rejects(build({ actors: [delver("a", 1)], temperaments: { ghost: 1 } }), /temperament for unknown actor: ghost/);
});

// ## TODO: Test Permutations
// - a temperament given as a string ("2") is refused
// - the actor's own field wins over the map for the same id
