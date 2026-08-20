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
    stamina: { current: hp, max: hp, regen: 2 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

function buildSimConfig({ width = 9, height = 3 } = {}) {
  const tiles = makeFloorGrid(width, height);
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "ds1_faction_sim",
      runId: "ds1_faction",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width,
        height,
        tiles,
        spawn: { x: 1, y: 1 },
        exit: { x: width - 2, y: 1 },
        rooms: [{ id: "R1", x: 0, y: 0, width, height }],
        hazards: [],
      },
    },
  };
}

/**
 * Two delvers standing adjacent, one warden further away.
 *
 * ⚠️ `archetype` ONLY — deliberately no `role` field. This mirrors what
 * `ak create` actually writes. Adding `role` here would make the test pass
 * against the old code and prove nothing.
 */
function buildInitialState() {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "ds1_faction_state",
      runId: "ds1_faction",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
    simConfigRef: {
      id: "ds1_faction_sim",
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors: [
      {
        id: "delver_a",
        kind: "ambulatory",
        archetype: "delver",
        position: { x: 1, y: 1 },
        motivation: { kind: "attacking" },
        vitals: makeVitals(10),
      },
      {
        id: "delver_b",
        kind: "ambulatory",
        archetype: "delver",
        position: { x: 2, y: 1 },
        motivation: { kind: "attacking" },
        vitals: makeVitals(10),
      },
      {
        id: "warden_1",
        kind: "ambulatory",
        archetype: "warden",
        position: { x: 6, y: 1 },
        motivation: { kind: "attacking" },
        vitals: makeVitals(10),
      },
    ],
  };
}

async function runRuntimeScenario({ ticks = TICK_COUNT } = {}) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const simConfig = buildSimConfig();
  const initialState = buildInitialState();
  const core = createCore();
  // Same seam the CLI `run` command uses (runtime/src/commands/kernel.js).
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { frames: runtime.getTickFrames(), initialState };
}

/** Every accepted attack across the run, as {attackerId, targetId}. */
function acceptedAttacks(frames) {
  const attacks = [];
  frames.forEach((frame) => {
    const accepted = Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [];
    accepted.forEach((action) => {
      if (action?.kind !== "attack") return;
      attacks.push({
        attackerId: action.actorId,
        targetId: action.params?.targetId,
      });
    });
  });
  return attacks;
}

// ---------------------------------------------------------------------------

test("in a real run over production-shaped data, no delver ever attacks a fellow delver", async () => {
  const { frames, initialState } = await runRuntimeScenario();

  const factionById = new Map(
    initialState.actors.map((actor) => [actor.id, actor.archetype]),
  );

  const friendlyFire = acceptedAttacks(frames).filter(({ attackerId, targetId }) => {
    const attackerFaction = factionById.get(attackerId);
    const targetFaction = factionById.get(targetId);
    if (!attackerFaction || !targetFaction) return false;
    return attackerFaction === targetFaction;
  });

  assert.deepEqual(
    friendlyFire,
    [],
    "same-faction actors attacked each other in a real runtime run. The persona-level rule (DS.2) "
      + "is correct but INERT here unless the faction signal actually reaches the observation: "
      + "core supplies no role, and generated initialState carries `archetype`, not `role`. If this "
      + "fails while the persona suite is green, the rule exists and production cannot see it.",
  );
});

test("the run is not vacuous — the delvers and the warden do engage each other", async () => {
  const { frames, initialState } = await runRuntimeScenario();

  const factionById = new Map(
    initialState.actors.map((actor) => [actor.id, actor.archetype]),
  );
  const crossFaction = acceptedAttacks(frames).filter(({ attackerId, targetId }) => {
    const attackerFaction = factionById.get(attackerId);
    const targetFaction = factionById.get(targetId);
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
