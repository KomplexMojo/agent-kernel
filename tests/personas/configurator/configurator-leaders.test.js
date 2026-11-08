/**
 * #408 (Darren, 2026-10-24): a minion is bound to one leader, who pays its mana upkeep. The
 * Configurator authors the bond: `leaders` beside the roster (`{ <minion id>: <leader id> }`),
 * from a `leader` on the actor, a `leaders` map, or by default an escort's ally. It stamps
 * `minionOf` on each minion for core, and refuses a missing leader, a self-bond or a cycle.
 */
"use strict";

const assert = require("node:assert/strict");

const FIXED = "2026-11-08T00:00:00.000Z";
const WIDTH = 6;
const HEIGHT = 3;
const VITALS = {
  health: { current: 20, max: 20, regen: 1 },
  mana: { current: 20, max: 20, regen: 1 },
  stamina: { current: 20, max: 20, regen: 1 },
  durability: { current: 20, max: 20, regen: 1 },
};
const terrain = () => Array(WIDTH * HEIGHT).fill("floor");
const delver = (id, x, motivations, extra = {}) => ({ id, category: "delver", position: { x, y: 1 }, motivations, vitals: VITALS, ...extra });

async function build(input) {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  return configurator.buildInitialStateArtifact({
    meta: { id: "s", runId: "s", createdAt: FIXED },
    simConfigRef: { id: "c", schema: "agon/SimConfigArtifact", schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: terrain(),
    ...input,
  });
}
const minionOf = (state, id) => state.actors.find((actor) => actor.id === id).minionOf;

test("a leader on the actor binds it: leaders beside the roster, minionOf on the record", async () => {
  const state = await build({ actors: [delver("hero", 1, ["user_controlled"]), delver("imp", 2, ["friendly"], { leader: "hero" })] });
  assert.deepEqual(state.leaders, { imp: "hero" });
  assert.equal(minionOf(state, "imp"), "hero");
  assert.equal(minionOf(state, "hero"), undefined);
});

test("a leaders map binds too, and with no bond the level carries none", async () => {
  const actors = [delver("hero", 1, ["user_controlled"]), delver("imp", 2, ["friendly"])];
  assert.deepEqual((await build({ actors, leaders: { imp: "hero" } })).leaders, { imp: "hero" });
  const bare = await build({ actors });
  assert.equal(bare.leaders, undefined);
  assert.equal(minionOf(bare, "imp"), undefined);
});

test("an escort's ally is its leader by default; an authored leader wins", async () => {
  const hero = delver("hero", 1, ["user_controlled"]);
  const guard = delver("guard", 4, ["exploring"]);
  const escorted = await build({ actors: [hero, delver("pal", 2, ["escorting"], { escort: { distance: 1 } })] });
  assert.deepEqual(escorted.leaders, { pal: "hero" });
  const named = await build({ actors: [hero, guard, delver("pal", 2, ["escorting"], { escort: { target: "guard" }, leader: "hero" })] });
  assert.deepEqual(named.leaders, { pal: "hero" });
  assert.equal(minionOf(named, "pal"), "hero");
});

test("refuses a missing leader, a self-bond and a cycle, naming the actor", async () => {
  const hero = delver("hero", 1, ["user_controlled"]);
  await assert.rejects(build({ actors: [hero, delver("imp", 2, [], { leader: "ghost" })] }), /imp.*leader.*ghost/);
  await assert.rejects(build({ actors: [hero, delver("imp", 2, [], { leader: "imp" })] }), /imp.*leader/);
  await assert.rejects(build({ actors: [delver("a", 1, [], { leader: "b" }), delver("b", 2, [], { leader: "a" })] }), /cycle/);
  await assert.rejects(build({ actors: [hero], leaders: { ghost: "hero" } }), /unknown actor: ghost/);
});

test("the run loader refuses a leaders map that disagrees with the records", async () => {
  const { initializeCoreFromArtifacts } = await import("../../../packages/runtime/src/runner/core-setup.mjs");
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "c", runId: "s", createdAt: FIXED },
    planRef: { id: "plan", schema: "agon/PlanArtifact", schemaVersion: 1 },
    layout: { width: WIDTH, height: HEIGHT, terrain: terrain() },
    movementStamina: { hero: 1, imp: 1 },
  });
  const state = await build({ actors: [delver("hero", 1, ["user_controlled"]), delver("imp", 2, ["friendly"], { leader: "hero" })] });
  assert.ok(initializeCoreFromArtifacts({ simConfig, initialState: state }).registry);
  assert.throws(() => initializeCoreFromArtifacts({ simConfig, initialState: { ...state, leaders: { hero: "imp" } } }), /leaders/);
});

// ## TODO: Test Permutations
// - a three-actor cycle (a -> b -> c -> a) is refused
// - a chain (a -> b -> c) is allowed: a leader may itself be a minion
// - an escort with no playable delver and no target carries no leader
