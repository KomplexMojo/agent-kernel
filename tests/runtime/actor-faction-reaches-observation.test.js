/**
 * DS.1 — the faction signal must reach the runtime observation, or DS.2 is inert.
 *
 * WHY THIS TEST EXISTS SEPARATELY FROM THE PERSONA TESTS.
 * `tests/personas/actor/actor-hostility-by-role.test.js` proves the *rule*:
 * an actor must not attack a same-role actor. It runs the persona directly with
 * `role` set by hand on the observation, which is how every actor persona test
 * supplies it.
 *
 * Real runs do not work that way, and the gap is total:
 *   - `core-ts` has NO concept of role — grep `ActorRole`/`getMotivatedActorRole`
 *     returns nothing. Roles are a runtime/config idea, so the observation core
 *     builds (`core-ts/src/mvp-movement.ts readObservation`) cannot carry one.
 *   - Generated `initialState` actors carry **`archetype: "delver"`**, not `role`
 *     (see any `initial-state.json` under `tests/fixtures/goldens`). `role` appears in
 *     `contracts/artifacts.ts` only on BUILD-SPEC HINT types, never on a runtime
 *     actor.
 *   - So in production `observation.actors[i].role` is `undefined` for everyone,
 *     every actor falls through DS.2's deliberate unknown-role fail-safe to
 *     "hostile", and the ally-attacking defect survives untouched in real runs
 *     while the persona suite is green.
 *
 * ⇒ *A rule that is correct in a unit test and unreachable in production is the
 * exact shape of defect this branch keeps re-finding.* This test runs the REAL
 * runtime over production-shaped data — `archetype` only, no hand-set `role` —
 * and forbids the defect end to end.
 */
"use strict";

const assert = require("node:assert/strict");

const TICK_COUNT = 6;
const WIDTH = 9;
const HEIGHT = 3;
const CLOCK = "2026-08-20T00:00:00.000Z";

function corridorTerrain() {
  const terrain = Array(WIDTH * HEIGHT).fill("floor");
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (x === 0 || x === WIDTH - 1 || y === 0 || y === HEIGHT - 1) terrain[y * WIDTH + x] = "wall";
    }
  }
  terrain[1 * WIDTH + (WIDTH - 2)] = "exit";
  return terrain;
}

function combatant(id, category, position) {
  return {
    id,
    category,
    position,
    motivations: ["attacking"],
    vitals: {
      health: { current: 10, max: 10, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 },
    },
    affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
    activeAffinityKey: "fire:push",
  };
}

/**
 * Two delvers standing adjacent, one warden further away.
 *
 * Category is the production presentation label. Configurator maps it to
 * alignment; tests must not hand-set role/archetype on the observation.
 */
async function buildArtifacts() {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const terrain = corridorTerrain();
  const actors = [
    combatant("delver_a", "delver", { x: 1, y: 1 }),
    combatant("delver_b", "delver", { x: 2, y: 1 }),
    combatant("warden_1", "warden", { x: 4, y: 1 }),
  ];
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "ds1_faction_sim", runId: "ds1_faction", createdAt: CLOCK, producedBy: "test" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width: WIDTH, height: HEIGHT, terrain, exitApproach: { x: WIDTH - 2, y: 1 } },
    movementStamina: { delver_a: 0, delver_b: 0, warden_1: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "ds1_faction_state", runId: "ds1_faction", createdAt: CLOCK, producedBy: "test" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain,
    actors,
  });
  return { simConfig, initialState };
}

async function runRuntimeScenario({ ticks = TICK_COUNT } = {}) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const { simConfig, initialState } = await buildArtifacts();
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { frames: runtime.getTickFrames(), initialState };
}

/** Every accepted focused cast across the run, as {attackerId, targetId}. */
function acceptedCasts(frames) {
  const casts = [];
  frames.forEach((frame) => {
    const accepted = Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [];
    accepted.forEach((action) => {
      if (action?.kind !== "cast_affinity") return;
      casts.push({
        attackerId: action.actorId,
        targetId: action.params?.targetId,
      });
    });
  });
  return casts;
}

function factionById(initialState) {
  return new Map(
    Object.entries(initialState.presentation).map(([id, entry]) => [id, entry.category]),
  );
}

// ---------------------------------------------------------------------------

test("in a real run over production-shaped data, no delver ever attacks a fellow delver", async () => {
  const { frames, initialState } = await runRuntimeScenario();
  const factions = factionById(initialState);

  const friendlyFire = acceptedCasts(frames).filter(({ attackerId, targetId }) => {
    const attackerFaction = factions.get(attackerId);
    const targetFaction = factions.get(targetId);
    if (!attackerFaction || !targetFaction) return false;
    return attackerFaction === targetFaction;
  });

  assert.deepEqual(
    friendlyFire,
    [],
    "same-faction actors attacked each other in a real runtime run. The persona-level rule (DS.2) "
      + "is correct but INERT here unless the faction signal actually reaches the observation: "
      + "core supplies no role, and generated initialState carries presentation category rather "
      + "than `role`. If this fails while the persona suite is green, the rule exists and "
      + "production cannot see it.",
  );
});

test("the run is not vacuous — the delvers and the warden do engage each other", async () => {
  const { frames, initialState } = await runRuntimeScenario();
  const factions = factionById(initialState);
  const crossFaction = acceptedCasts(frames).filter(({ attackerId, targetId }) => {
    const attackerFaction = factions.get(attackerId);
    const targetFaction = factions.get(targetId);
    if (!attackerFaction || !targetFaction) return false;
    return attackerFaction !== targetFaction;
  });

  assert.ok(
    crossFaction.length > 0,
    "no cross-faction attack happened at all, so the friendly-fire assertion above proves nothing — "
      + "it would pass equally on a board where combat had stopped entirely. Something upstream "
      + "(stamina, adjacency, motivation gating) is preventing engagement and must be fixed before "
      + "this file can vouch for DS.1.",
  );
});

// ## TODO: Test Permutations
//
// - initialState carrying `role` INSTEAD of `archetype` (hand-authored fixtures do
//   this): must behave identically
// - initialState carrying BOTH, in agreement: identical again
// - an actor with neither: stays hostile to everyone (the DS.2 fail-safe, end to end)
// - wardens-only roster: no attacks at all, and the run still completes its ticks
// - replay: the same seed produces the identical attack sequence twice
