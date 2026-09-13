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

function vitals(amount) {
  return {
    health: { current: amount, max: amount, regen: 0 },
    mana: { current: amount, max: amount, regen: 0 },
    stamina: { current: amount, max: amount, regen: 0 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

/**
 * Wall-portal layout with a 2D interior so `patrolling` can emit room-ring moves.
 * A 1-tile-tall corridor collapses the patrol ring to [], which falls through to exit
 * pathing — and after portal-in-wall, wardens wait while delvers take EXIT_PROGRESS,
 * so the equal-intent control can no longer observe the alphabetical tie-break.
 */
function simConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "order_sim", runId: "order", createdAt: FIXED },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 7,
        height: 5,
        tiles: [
          "#######",
          "#.....#",
          "S.....#",
          "#....E#",
          "#######",
        ],
        spawn: { x: 0, y: 2 },
        exit: { x: 6, y: 3 },
        spawnApproach: { x: 1, y: 2 },
        exitApproach: { x: 5, y: 3 },
        rooms: [{ id: "R1", x: 1, y: 1, width: 5, height: 3 }],
        hazards: [],
      },
    },
  };
}

/** `a_warden` leads the array; `z_delver` trails it and trails alphabetically too. */
function initialState({ delverMotivation, wardenPos, delverPos }) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "order_state", runId: "order", createdAt: FIXED },
    simConfigRef: { id: "order_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors: [
      {
        id: "a_warden",
        kind: "ambulatory",
        archetype: "warden",
        position: wardenPos,
        role: "warden",
        motivation: { kind: "patrolling" },
        vitals: vitals(6),
      },
      {
        id: "z_delver",
        kind: "ambulatory",
        archetype: "delver",
        position: delverPos,
        role: "delver",
        motivation: { kind: delverMotivation },
        vitals: vitals(10),
      },
    ],
  };
}

async function resolutionOrder({ delverMotivation, wardenPos, delverPos }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../../packages/runtime/src/runner/runtime.js"),
    import("../../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({
    seed: 0,
    simConfig: simConfig(),
    initialState: initialState({ delverMotivation, wardenPos, delverPos }),
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
  // Adjacent seats so the attacking delver can land a combat action.
  const { order, accepted } = await resolutionOrder({
    delverMotivation: "attacking",
    wardenPos: { x: 4, y: 2 },
    delverPos: { x: 3, y: 2 },
  });

  assert.deepEqual(order, ["z_delver", "a_warden"]);
  assert.equal(
    accepted.find((action) => action.actorId === "z_delver").kind,
    "attack",
    "the scenario is only meaningful while the delver actually attacks (intent class 500)",
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
    accepted.every((action) => action.kind !== "attack"),
    "the control must not contain a combat action, or it is not a control",
  );
});

// ## TODO: Test Permutations
// - three actors where the middle one holds the only combat intent
// - an actor that surfaces no intention at all still resolves, behind every actor that did
