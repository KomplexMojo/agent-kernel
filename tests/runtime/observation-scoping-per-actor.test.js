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
const WIDTH = 15;
const HEIGHT = 3;
const OBSERVER_X = 5;
const CLOCK = "2026-08-20T00:00:00.000Z";

function corridorTerrain() {
  const terrain = Array(WIDTH * HEIGHT).fill("floor");
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (x === 0 || x === WIDTH - 1 || y === 0 || y === HEIGHT - 1) terrain[y * WIDTH + x] = "wall";
    }
  }
  // Exit sits WEST of the observer; the far actor sits EAST. That is what
  // makes the assertion directional and unambiguous: an actor that can see
  // the distant one walks east toward it, an actor that cannot walks west
  // toward the exit.
  terrain[1 * WIDTH + 1] = "exit";
  return terrain;
}

function health(id, category, position, motivations) {
  return {
    id,
    category,
    position,
    motivations,
    vitals: { health: { current: 10, max: 10, regen: 0 } },
  };
}

/**
 * Levels are unlit (ruled 2026-10-10): an observer that emits no light sees one
 * tile. LIT_STACKS of emitted light extend that to a radius of 3, which the
 * distance tests below are written against.
 */
const LIT_STACKS = 2;
const LIT_RADIUS = 3;

/**
 * @param {number} otherX where the second actor stands. The observer is always
 *   actors[0] at x=5, so `otherX` decides whether it is within sight.
 * @param {{ lit?: boolean }} [options] whether the observer emits LIT_STACKS of light.
 */
async function buildArtifacts(otherX, { lit = true } = {}) {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const terrain = corridorTerrain();
  const actors = [
    // INDEX 0 ON PURPOSE — the actor that observes in the OBSERVE phase and
    // is therefore missed by a DECIDE-only fix. See the header.
    {
      ...health("observer", "delver", { x: OBSERVER_X, y: 1 }, ["attacking"]),
      ...(lit ? {
        affinities: [{ kind: "light", expression: "emit", stacks: LIT_STACKS }],
        activeAffinityKey: "light:emit",
      } : {}),
    },
    health("other", "warden", { x: otherX, y: 1 }, ["stationary"]),
  ];
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "ds4_scoping_sim", runId: "ds4_scoping", createdAt: CLOCK, producedBy: "test" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width: WIDTH, height: HEIGHT, terrain, exitApproach: { x: 1, y: 1 } },
    movementStamina: { observer: 0, other: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "ds4_scoping_state", runId: "ds4_scoping", createdAt: CLOCK, producedBy: "test" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain,
    actors,
  });
  return { simConfig, initialState };
}

async function runScenario(otherX, options) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const { simConfig, initialState } = await buildArtifacts(otherX, options);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
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
      const target = action.params?.target;
      if (!target || !Number.isInteger(target.x)) continue;
      return target.x - OBSERVER_X;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

test("actor 0 does NOT pursue an actor standing beyond its sight radius", async () => {
  // `other` is 7 tiles east — more than double the lit radius of 3.
  const frames = await runScenario(12);
  const dx = firstObserverMoveDx(frames);

  assert.notEqual(dx, null, "the observer must move at all — a run where it never acts proves nothing");
  assert.ok(
    dx < 0,
    `the observer moved ${dx > 0 ? "EAST, toward an actor it cannot see" : "nowhere"}. At 7 tiles `
      + `away, \`other\` is outside the lit sight radius of ${LIT_RADIUS}, so the observer should be walking `
      + "WEST toward the exit instead. Moving east means the observation reaching the Actor persona "
      + "still contains the whole board — scoping is not being applied where the actor payload is "
      + "built, or the radius came back larger than the light allows.",
  );
});

test("NOT VACUOUS: actor 0 DOES pursue an actor standing inside its sight radius", async () => {
  // `other` is 2 tiles east — comfortably within the lit radius of 3.
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

test("an observer that emits no light does NOT pursue an actor two tiles away", async () => {
  // The same distance the lit observer pursues above. Unlit, sight is one tile.
  const frames = await runScenario(7, { lit: false });
  const dx = firstObserverMoveDx(frames);

  assert.notEqual(dx, null, "the observer must move at all");
  assert.ok(
    dx < 0,
    "an unlit observer pursued an actor two tiles away. Levels are unlit: without its own "
      + "emitted light an actor sees only what is adjacent.",
  );
});

// ## TODO: Test Permutations
//
// - the same three distances with the observer at index 1 instead of 0 (the
//   DECIDE-loop path, which a naive fix DOES cover — proving both paths agree)
// - an observer standing in dark at/above the obscure threshold: sight collapses
//   to 1, and an actor 2 tiles away is no longer pursued
// - (deliberately NOT listed: "non-actor personas still get the full observation".
//   Only `actorPayload` ever carries an `observation` at all — the annotator gets
//   an `observations` array built from `observationLog`, which holds effects, not
//   actor lists. There is nothing to assert, and a stub implying otherwise would
//   send whoever expands these permutations chasing a property that cannot exist.)
// - replay determinism: the same seed produces identical frames with scoping on
// - a run where every actor is out of range of every other: completes its ticks
//   without stalling, and nobody attacks
