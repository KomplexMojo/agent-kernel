/**
 * DS.4 — an actor decides from what it can SEE, not from the whole board.
 *
 * THE DEFECT THIS FORBIDS. Every tick the runtime builds ONE observation
 * snapshot (`runtime-fsm.mjs` -> `resolveObservation` -> core's `readObservation`)
 * containing every actor's exact position and exact vitals, with no distance
 * check, no line of sight and no detection radius anywhere in the path. That one
 * snapshot is handed to every actor. `resolveVisibleActors` in the Actor
 * controller then excludes only *self* — so "visibleActors" has meant "every
 * other actor in the game", and a delver has been able to read a warden's HP
 * across the map through any number of walls.
 *
 * DS.3 built the mechanism (`core-ts/src/state/visibility.ts`: baseline 3 tiles
 * Chebyshev, modulated by light/dark, floored at 1) and deliberately wired it to
 * nothing. THIS milestone wires it, and is therefore the one where behavior
 * actually changes.
 *
 * ⚠️ **WHAT THESE TESTS DO NOT GATE — stated plainly, because the milestone plan
 * predicted they would.** The plan expected an OBSERVE/DECIDE asymmetry to be the
 * trap here: the DECIDE phase loops per actor and passes an `actorId`, while the
 * OBSERVE phase passes none and falls back to the primary actor, so a fix applied
 * only to the DECIDE loop would leave actor 0 omniscient while actors 1..n were
 * scoped. The implementation covers both anyway (it scopes at the single place
 * the actor payload is constructed, which both phases flow through).
 *
 * But the predicted perturbation — scope the DECIDE loop only, leave OBSERVE
 * global — was RUN, and these tests stayed GREEN. The asymmetry is real in
 * structure and inert in behavior: the Actor persona does not cache the
 * observation it was given during OBSERVE (CR.6 removed exactly that
 * `lastObservation` fallback), so every proposal is decided from the DECIDE
 * payload, which always carries an explicit `actorId`. Nothing observable
 * depends on the OBSERVE payload today.
 *
 * ⇒ *The OBSERVE-side scoping is therefore DEFENSIVE, not gated. It is kept
 * because a future consumer of that payload would otherwise silently inherit
 * omniscience — but no test in this file would notice if it were removed, and
 * claiming otherwise in a header would be precisely the guard-spelling defect
 * this repo keeps re-finding.* Every test below still pins the observer at
 * index 0, which is the harder path and costs nothing.
 */
"use strict";

const assert = require("node:assert/strict");

const TICK_COUNT = 3;

function makeFloorGrid(w, h) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "#" : "."
    ).join("")
  );
}

function makeVitals(hp) {
  return {
    health: { current: hp, max: hp, regen: 0 },
    mana: { current: hp, max: hp, regen: 0 },
    stamina: { current: hp, max: hp, regen: 4 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

const WIDTH = 15;
const HEIGHT = 3;

function buildSimConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "ds4_scoping_sim", runId: "ds4_scoping", createdAt: "2026-08-20T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: WIDTH,
        height: HEIGHT,
        tiles: makeFloorGrid(WIDTH, HEIGHT),
        spawn: { x: 5, y: 1 },
        // Exit sits WEST of the observer; the far actor sits EAST. That is what
        // makes the assertion directional and unambiguous: an actor that can see
        // the distant one walks east toward it, an actor that cannot walks west
        // toward the exit.
        exit: { x: 1, y: 1 },
        rooms: [{ id: "R1", x: 0, y: 0, width: WIDTH, height: HEIGHT }],
        hazards: [],
      },
    },
  };
}

/**
 * @param {number} otherX where the second actor stands. The observer is always
 *   actors[0] at x=5, so `otherX` alone decides whether it is within the
 *   baseline sight radius of 3.
 */
function buildInitialState(otherX) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "ds4_scoping_state", runId: "ds4_scoping", createdAt: "2026-08-20T00:00:00.000Z" },
    simConfigRef: {
      id: "ds4_scoping_sim",
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors: [
      {
        // INDEX 0 ON PURPOSE — the actor that observes in the OBSERVE phase and
        // is therefore missed by a DECIDE-only fix. See the header.
        id: "observer",
        kind: "ambulatory",
        archetype: "delver",
        position: { x: 5, y: 1 },
        motivation: { kind: "attacking" },
        vitals: makeVitals(10),
      },
      {
        id: "other",
        kind: "ambulatory",
        archetype: "warden",
        position: { x: otherX, y: 1 },
        motivation: { kind: "stationary" },
        vitals: makeVitals(10),
      },
    ],
  };
}

async function runScenario(otherX) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig: buildSimConfig(), initialState: buildInitialState(otherX) });
  for (let t = 0; t < TICK_COUNT; t += 1) {
    await runtime.step();
  }
  return runtime.getTickFrames();
}

/** The observer's first move of the run, as a signed x delta. */
function firstObserverMoveDx(frames) {
  for (const frame of frames) {
    const accepted = Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [];
    for (const action of accepted) {
      if (action?.actorId !== "observer") continue;
      if (action.kind !== "move") continue;
      const from = action.params?.from;
      const to = action.params?.to;
      if (!from || !to) continue;
      return to.x - from.x;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

test("actor 0 does NOT pursue an actor standing beyond its sight radius", async () => {
  // `other` is 7 tiles east — more than double the baseline radius of 3.
  const frames = await runScenario(12);
  const dx = firstObserverMoveDx(frames);

  assert.notEqual(dx, null, "the observer must move at all — a run where it never acts proves nothing");
  assert.ok(
    dx < 0,
    `the observer moved ${dx > 0 ? "EAST, toward an actor it cannot see" : "nowhere"}. At 7 tiles `
      + "away, `other` is outside the baseline sight radius of 3, so the observer should be walking "
      + "WEST toward the exit instead. Moving east means the observation reaching the Actor persona "
      + "still contains the whole board — scoping is not being applied where the actor payload is "
      + "built, or the radius came back larger than the baseline.",
  );
});

test("NOT VACUOUS: actor 0 DOES pursue an actor standing inside its sight radius", async () => {
  // `other` is 2 tiles east — comfortably within the baseline radius of 3.
  const frames = await runScenario(7);
  const dx = firstObserverMoveDx(frames);

  assert.notEqual(dx, null, "the observer must move at all");
  assert.ok(
    dx > 0,
    `the observer moved ${dx < 0 ? "WEST, ignoring an actor it can plainly see" : "nowhere"}. `
      + "Without this, the test above would pass equally on an implementation that blinded every "
      + "actor completely — scoping must narrow perception, not abolish it.",
  );
});

test("the boundary is inclusive: an actor at exactly the sight radius is still seen", async () => {
  // Chebyshev distance exactly 3 from x=5.
  const frames = await runScenario(8);
  const dx = firstObserverMoveDx(frames);

  assert.notEqual(dx, null, "the observer must move at all");
  assert.ok(
    dx > 0,
    "an actor at exactly the sight radius must be visible — `<= radius`, not `< radius`. An "
      + "off-by-one here silently shrinks every actor's perception by a tile.",
  );
});

// ## TODO: Test Permutations
//
// - the same three distances with the observer at index 1 instead of 0 (the
//   DECIDE-loop path, which a naive fix DOES cover — proving both paths agree)
// - an observer standing in dark at/above the obscure threshold: sight collapses
//   to 1, and an actor 2 tiles away is no longer pursued
// - an observer emitting light: pursues an actor beyond the baseline radius
// - (deliberately NOT listed: "non-actor personas still get the full observation".
//   Only `actorPayload` ever carries an `observation` at all — the annotator gets
//   an `observations` array built from `observationLog`, which holds effects, not
//   actor lists. There is nothing to assert, and a stub implying otherwise would
//   send whoever expands these permutations chasing a property that cannot exist.)
// - replay determinism: the same seed produces identical frames with scoping on
// - a run where every actor is out of range of every other: completes its ticks
//   without stalling, and nobody attacks
