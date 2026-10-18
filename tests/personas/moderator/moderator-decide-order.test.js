/**
 * The Moderator rules DECIDE order too, from the previous tick's intentions (#164).
 *
 * Decide order matters because each actor sees `reservedTargets`, the tiles claimed by
 * actors that decided earlier in the same tick, so whoever decides first takes a contested
 * tile before resolution order is consulted. Intentions do not exist until an actor has
 * decided, so the ruling reads LAST tick's (maintainer ruling, 2026-10-18): the same signal
 * resolution order uses, one tick stale. Tick 1 has none and falls back to id order.
 */
"use strict";

const assert = require("node:assert/strict");

async function moderator() {
  return import("../../../packages/runtime/src/personas/moderator/persona.js");
}
async function contract() {
  return import("../../../packages/runtime/src/contracts/actor-intention.js");
}

test("with no previous intentions, actors decide in id order whatever order they were listed", async () => {
  const { orderActorsForDecision } = await moderator();
  assert.deepEqual(
    orderActorsForDecision({ actorIds: ["z_delver", "a_warden", "m_delver"] }),
    ["a_warden", "m_delver", "z_delver"],
  );
});

test("the higher previous intent decides first, ties break on id, unreported actors decide last", async () => {
  const { orderActorsForDecision } = await moderator();
  const { buildActorIntention } = await contract();
  const previousIntentions = [
    buildActorIntention({ actorId: "z_delver", intentClass: 500, intentTag: "in_range_combat", tick: 1 }),
    buildActorIntention({ actorId: "b_delver", intentClass: 200, intentTag: "mobile_lateral", tick: 1 }),
    buildActorIntention({ actorId: "a_warden", intentClass: 200, intentTag: "mobile_lateral", tick: 1 }),
  ];
  assert.deepEqual(
    orderActorsForDecision({ actorIds: ["a_warden", "b_delver", "c_new", "z_delver"], previousIntentions }),
    ["z_delver", "a_warden", "b_delver", "c_new"],
  );
});

// BINDING: the runner must actually ask actors to propose in that order. `z_delver` sorts
// last by id and by the authored array, so it can only decide first on tick 2 because its
// tick-1 intent was combat.
const FIXED = "2026-01-01T00:00:00.000Z";
const WIDTH = 7;
const HEIGHT = 5;

function terrain() {
  const tiles = ["#######", "#.....#", "S.....#", "#....E#", "#######"];
  const kind = { "#": "wall", ".": "floor", S: "spawn", E: "exit" };
  return tiles.flatMap((row) => [...row].map((cell) => kind[cell]));
}

async function decideOrders({ delverMotivation, delverPos, wardenPos, ticks = 2 }) {
  const [{ createRuntime }, { createCore }, { createConfiguratorPersona }] = await Promise.all([
    import("../../../packages/runtime/src/runner/runtime.js"),
    import("../../../packages/core-ts/src/index.ts"),
    import("../../../packages/runtime/src/personas/configurator/controller.js"),
  ]);
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  const layout = {
    width: WIDTH, height: HEIGHT, terrain: terrain(),
    rooms: [{ id: "R1", x: 1, y: 1, width: 5, height: 3 }],
    spawnApproach: { x: 1, y: 2 }, exitApproach: { x: 5, y: 3 },
  };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "decide_sim", runId: "decide", createdAt: FIXED },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { a_warden: 0, z_delver: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "decide_state", runId: "decide", createdAt: FIXED },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: layout.terrain,
    actors: [
      { id: "a_warden", category: "warden", position: wardenPos, motivations: ["patrolling"],
        vitals: { health: { current: 60, max: 60, regen: 0 } } },
      { id: "z_delver", category: "delver", position: delverPos, motivations: [delverMotivation],
        vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 100, max: 100, regen: 0 } },
        affinities: [{ kind: "fire", expression: "push", stacks: 2 }], activeAffinityKey: "fire:push" },
    ],
  });
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  for (let i = 0; i < ticks; i += 1) await runtime.step();
  return runtime.getTickFrames()
    .filter((frame) => frame?.phaseDetail === "decide")
    .map((frame) => {
      const seen = [];
      for (const action of frame.personaActions || []) {
        if (typeof action?.actorId === "string" && !seen.includes(action.actorId)) seen.push(action.actorId);
      }
      return seen;
    });
}

test("an actor whose last intent was combat decides first on the next tick", async () => {
  // The kind is data: any affinity the delver can cast at an adjacent warden serves.
  const orders = await decideOrders({ delverMotivation: "attacking", wardenPos: { x: 4, y: 2 }, delverPos: { x: 3, y: 2 } });
  assert.deepEqual(orders[0], ["a_warden", "z_delver"], "tick 1 has no previous intent, so id order");
  assert.deepEqual(orders[1], ["z_delver", "a_warden"]);
});

test("equal previous intents keep id order (the control)", async () => {
  const orders = await decideOrders({ delverMotivation: "patrolling", wardenPos: { x: 4, y: 2 }, delverPos: { x: 2, y: 2 } });
  assert.deepEqual(orders[1], ["a_warden", "z_delver"]);
});

// ## TODO: Test Permutations
// - three actors where the middle one held the only combat intent last tick
// - an actor that exited or was defeated drops out of the next tick's decide order
