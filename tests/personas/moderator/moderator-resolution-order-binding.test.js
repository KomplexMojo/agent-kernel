/**
 * The Moderator's actor ordering is BOUND to core resolution — not merely computed.
 *
 * `moderator-actor-ordering.test.js` proves the ordering policy is correct in isolation. This
 * file proves it is LOAD-BEARING: that the runner actually applies actions in the order the
 * Moderator ruled, rather than in `initialState.actors` array order. Without this, the whole
 * seam could be a no-op that computes a ruling nobody reads — which is exactly what shipped in
 * `edaa299`, and what a passing ordering-policy suite would not have caught.
 *
 * THE SCENARIO ISOLATES INTENT FROM BOTH ACCIDENTS IT REPLACES. `a_warden` is first in the
 * actor array AND first alphabetically; `z_delver` is last by both. So if `z_delver` resolves
 * first, neither array order nor the id tie-break can explain it — only its intent class can.
 * Get either wrong and the assertion fails rather than passing for the old reason.
 */
"use strict";

const assert = require("node:assert/strict");

const FIXED = "2026-01-01T00:00:00.000Z";
const WIDTH = 7;
const HEIGHT = 5;

/**
 * Wall-portal layout with a 2D interior so `patrolling` can emit room-ring moves.
 * A 1-tile-tall corridor collapses the patrol ring to [], which falls through to exit
 * pathing — and after portal-in-wall, wardens wait while delvers take EXIT_PROGRESS,
 * so the equal-intent control can no longer observe the alphabetical tie-break.
 */
function terrain() {
  const tiles = [
    "#######",
    "#.....#",
    "S.....#",
    "#....E#",
    "#######",
  ];
  const kind = { "#": "wall", ".": "floor", S: "spawn", E: "exit" };
  return tiles.flatMap((row) => [...row].map((cell) => kind[cell]));
}

async function artifacts({ delverMotivation, wardenPos, delverPos }) {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => FIXED });
  const layout = {
    width: WIDTH,
    height: HEIGHT,
    terrain: terrain(),
    rooms: [{ id: "R1", x: 1, y: 1, width: 5, height: 3 }],
    spawnApproach: { x: 1, y: 2 },
    exitApproach: { x: 5, y: 3 },
  };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "order_sim", runId: "order", createdAt: FIXED },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { a_warden: 0, z_delver: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "order_state", runId: "order", createdAt: FIXED },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: layout.terrain,
    actors: [
      {
        id: "a_warden",
        category: "warden",
        position: wardenPos,
        motivations: ["patrolling"],
        vitals: { health: { current: 6, max: 6, regen: 0 } },
      },
      {
        id: "z_delver",
        category: "delver",
        position: delverPos,
        motivations: [delverMotivation],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 10, max: 10, regen: 0 },
        },
        affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
        activeAffinityKey: "fire:push",
      },
    ],
  });
  return { simConfig, initialState };
}

async function resolutionOrder({ delverMotivation, wardenPos, delverPos }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../../packages/runtime/src/runner/runtime.js"),
    import("../../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({
    seed: 0,
    ...(await artifacts({ delverMotivation, wardenPos, delverPos })),
  });
  await runtime.step();
  const accepted = runtime.getTickFrames()
    .flatMap((frame) => (Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []));
  assert.ok(accepted.length >= 2, "the tick must resolve at least one action per actor");
  const seen = [];
  for (const action of accepted) {
    if (typeof action?.actorId === "string" && !seen.includes(action.actorId)) seen.push(action.actorId);
  }
  return { order: seen, accepted };
}

test("a combat intent resolves first even from the back of the actor array", async () => {
  // Adjacent seats so the attacking delver can land a focused cast.
  const { order, accepted } = await resolutionOrder({
    delverMotivation: "attacking",
    wardenPos: { x: 4, y: 2 },
    delverPos: { x: 3, y: 2 },
  });

  assert.deepEqual(order, ["z_delver", "a_warden"]);
  assert.equal(
    accepted.find((action) => action.actorId === "z_delver").kind,
    "cast_affinity",
    "the scenario is only meaningful while the delver actually casts (intent class 500)",
  );
});

test("equal intents fall back to the id tie-break, restoring the alphabetical order", async () => {
  // THE NEGATIVE CONTROL. Same array / code path; both patrol so intent classes match
  // (room-ring moves). If the combat case passed for a reason other than intent class,
  // this still puts `z_delver` first under the alphabetical tie-break.
  const { order, accepted } = await resolutionOrder({
    delverMotivation: "patrolling",
    wardenPos: { x: 4, y: 2 },
    delverPos: { x: 2, y: 2 },
  });

  assert.deepEqual(order, ["a_warden", "z_delver"]);
  assert.ok(
    accepted.every((action) => action.kind !== "attack" && action.kind !== "cast_affinity"),
    "the control must not contain a combat action, or it is not a control",
  );
});

// ## TODO: Test Permutations
// - three actors where the middle one holds the only combat intent
// - an actor that surfaces no intention at all still resolves, behind every actor that did
