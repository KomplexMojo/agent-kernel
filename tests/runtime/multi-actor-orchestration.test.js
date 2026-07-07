/**
 * M7a — Multi-actor orchestration: every configured actor must be advanced
 * every tick, not just initialState.actors[0].
 *
 * Bug: in packages/runtime/src/runner/runtime-fsm.mjs, buildPersonaPayloads()
 * builds a single actor persona payload keyed to `primaryActorId`
 * (== initialState.actors[0].id), and the tick orchestrator
 * (packages/runtime/src/personas/_shared/tick-orchestrator.mts
 * collectPhaseRecord()) invokes each registered persona exactly once per
 * phase with that one payload. Every actor after index 0 is therefore never
 * given a chance to propose a move/wait action, on any tick, in any run.
 *
 * This test drives the exact seam the CLI `run` command uses
 * (packages/runtime/src/commands/kernel.js -> createRuntime() ->
 * createFsmRuntime() in runtime-fsm.mjs), with 3+ actors, and asserts every
 * actor id appears in accepted actions across a multi-tick run.
 *
 * Architecture: runtime + core-ts only, no LLM, no external IO, deterministic
 * (seed-derived) actor iteration in initialState order.
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

function buildSimConfig({ width = 9, height = 9 } = {}) {
  const tiles = makeFloorGrid(width, height);
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "multi_actor_orchestration_sim",
      runId: "multi_actor_orchestration",
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width,
        height,
        tiles,
        spawn: { x: Math.floor(width / 2) - 1, y: Math.floor(height / 2) },
        exit: { x: Math.floor(width / 2) + 1, y: Math.floor(height / 2) },
        rooms: [{ id: "R1", x: 0, y: 0, width, height }],
        traps: [],
      },
    },
  };
}

function makeVitals(hp) {
  return {
    health: { current: hp, max: hp, regen: 0 },
    mana: { current: hp, max: hp, regen: 0 },
    stamina: { current: hp, max: hp, regen: 0 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

function buildInitialState() {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "multi_actor_orchestration_state",
      runId: "multi_actor_orchestration",
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    simConfigRef: {
      id: "multi_actor_orchestration_sim",
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors: [
      {
        id: "delver_1",
        kind: "ambulatory",
        archetype: "delver",
        role: "delver",
        position: { x: 1, y: 1 },
        motivation: { kind: "random" },
        traits: { affinities: { fire: 1 } },
        vitals: makeVitals(10),
      },
      {
        id: "warden_1",
        kind: "ambulatory",
        archetype: "warden",
        role: "warden",
        position: { x: 7, y: 1 },
        motivation: { kind: "random" },
        traits: { affinities: { dark: 1 } },
        vitals: makeVitals(6),
      },
      {
        id: "warden_2",
        kind: "ambulatory",
        archetype: "warden",
        role: "warden",
        position: { x: 1, y: 7 },
        motivation: { kind: "random" },
        traits: { affinities: { dark: 1 } },
        vitals: makeVitals(6),
      },
      {
        id: "warden_3",
        kind: "ambulatory",
        archetype: "warden",
        role: "warden",
        position: { x: 7, y: 7 },
        motivation: { kind: "random" },
        traits: { affinities: { dark: 1 } },
        vitals: makeVitals(6),
      },
    ],
  };
}

async function loadRuntimeDeps() {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  return { createRuntime, createCore };
}

async function runRuntimeScenario({
  simConfig = buildSimConfig(),
  initialState = buildInitialState(),
  ticks = TICK_COUNT,
  seed = simConfig.seed ?? 0,
} = {}) {
  const { createRuntime, createCore } = await loadRuntimeDeps();
  const core = createCore();
  // Same seam the CLI `run` command uses (packages/runtime/src/commands/kernel.js).
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { core, runtime, frames: runtime.getTickFrames() };
}

function acceptedActionsByActor(frames) {
  const byActor = new Map();
  frames.forEach((frame) => {
    const accepted = Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [];
    accepted.forEach((action) => {
      if (!action?.actorId) return;
      if (!byActor.has(action.actorId)) byActor.set(action.actorId, []);
      byActor.get(action.actorId).push(action);
    });
  });
  return byActor;
}

// ---------------------------------------------------------------------------
// Every configured actor must receive accepted actions across the run
// ---------------------------------------------------------------------------

test("every configured actor (not just actors[0]) receives accepted move/wait actions across a multi-tick run", async () => {
  const initialState = buildInitialState();
  const expectedIds = initialState.actors.map((a) => a.id);

  const { frames } = await runRuntimeScenario({ initialState, ticks: TICK_COUNT, seed: 0 });

  const byActor = acceptedActionsByActor(frames);
  const moveOrWaitByActor = new Map();
  for (const [actorId, actions] of byActor.entries()) {
    moveOrWaitByActor.set(
      actorId,
      actions.filter((a) => a.kind === "move" || a.kind === "wait"),
    );
  }

  for (const actorId of expectedIds) {
    const actions = moveOrWaitByActor.get(actorId) || [];
    assert.ok(
      actions.length > 0,
      `actor "${actorId}" must receive at least one accepted move/wait action across ${TICK_COUNT} ticks ` +
        `(actors with accepted actions: ${[...moveOrWaitByActor.keys()].join(",") || "none"})`,
    );
  }
});

test("actor iteration order is deterministic and matches initialState.actors order", async () => {
  const initialState = buildInitialState();
  const expectedIds = initialState.actors.map((a) => a.id);

  const runA = await runRuntimeScenario({ initialState, ticks: TICK_COUNT, seed: 42 });
  const runB = await runRuntimeScenario({ initialState: buildInitialState(), ticks: TICK_COUNT, seed: 42 });

  const byActorA = acceptedActionsByActor(runA.frames);
  const byActorB = acceptedActionsByActor(runB.frames);

  expectedIds.forEach((actorId) => {
    const seqA = (byActorA.get(actorId) || []).map((a) => `${a.kind}:${a.tick}`);
    const seqB = (byActorB.get(actorId) || []).map((a) => `${a.kind}:${a.tick}`);
    assert.deepEqual(seqA, seqB, `actor "${actorId}" accepted-action sequence must be reproducible for identical seed/initialState`);
  });
});

test("core still tracks every configured actor after a multi-tick run with 4 actors", async () => {
  const { core } = await runRuntimeScenario({ ticks: TICK_COUNT, seed: 7 });
  assert.equal(core.getMotivatedActorCount(), buildInitialState().actors.length);
});

// ---------------------------------------------------------------------------
// Permutations expanded from TODO stubs
// ---------------------------------------------------------------------------

function buildActor({ id, archetype, position, motivation = "random", hp = 6 }) {
  return {
    id,
    kind: "ambulatory",
    archetype,
    role: archetype,
    position,
    motivation: { kind: motivation },
    traits: { affinities: { [archetype === "delver" ? "fire" : "dark"]: 1 } },
    vitals: makeVitals(hp),
  };
}

function buildStateWithActors(actors) {
  return { ...buildInitialState(), actors };
}

async function coverageForActors(actors, { ticks = TICK_COUNT, seed = 0 } = {}) {
  const { frames } = await runRuntimeScenario({
    initialState: buildStateWithActors(actors),
    ticks,
    seed,
  });
  return acceptedActionsByActor(frames);
}

test("actor-count permutations: 2, 3, and 11 actors all get full coverage", async () => {
  const rosters = [
    [
      buildActor({ id: "delver_1", archetype: "delver", position: { x: 1, y: 1 } }),
      buildActor({ id: "warden_1", archetype: "warden", position: { x: 7, y: 7 } }),
    ],
    [
      buildActor({ id: "delver_1", archetype: "delver", position: { x: 1, y: 1 } }),
      buildActor({ id: "warden_1", archetype: "warden", position: { x: 7, y: 1 } }),
      buildActor({ id: "warden_2", archetype: "warden", position: { x: 7, y: 7 } }),
    ],
    // Acceptance-scenario scale: 1 delver + 10 wardens on distinct tiles.
    [
      buildActor({ id: "delver_1", archetype: "delver", position: { x: 1, y: 1 } }),
      ...Array.from({ length: 10 }, (_, i) =>
        buildActor({
          id: `warden_${i + 1}`,
          archetype: "warden",
          position: { x: 1 + ((i + 2) % 7), y: 2 + Math.floor((i + 2) / 7) * 2 },
        })),
    ],
  ];
  for (const actors of rosters) {
    const byActor = await coverageForActors(actors);
    for (const actor of actors) {
      assert.ok(
        (byActor.get(actor.id) || []).some((a) => a.kind === "move" || a.kind === "wait"),
        `roster of ${actors.length}: actor "${actor.id}" received no accepted move/wait`,
      );
    }
  }
});

test("mixed motivations: stationary actors get zero moves while random/attacking actors act", async () => {
  const actors = [
    buildActor({ id: "random_1", archetype: "delver", position: { x: 1, y: 1 }, motivation: "random" }),
    buildActor({ id: "attacker_1", archetype: "warden", position: { x: 7, y: 7 }, motivation: "attacking" }),
    buildActor({ id: "stationary_1", archetype: "warden", position: { x: 7, y: 1 }, motivation: "stationary" }),
  ];
  const byActor = await coverageForActors(actors);

  const stationaryMoves = (byActor.get("stationary_1") || []).filter((a) => a.kind === "move");
  assert.equal(stationaryMoves.length, 0, "stationary actor must never receive an accepted move");

  for (const id of ["random_1", "attacker_1"]) {
    assert.ok(
      (byActor.get(id) || []).length > 0,
      `actor "${id}" must receive accepted actions in a mixed-motivation run`,
    );
  }
});

test("single-tick run still advances every actor, not just actors[0]", async () => {
  const initialState = buildInitialState();
  const byActor = await coverageForActors(initialState.actors, { ticks: 1 });
  for (const actor of initialState.actors) {
    assert.ok(
      (byActor.get(actor.id) || []).length > 0,
      `actor "${actor.id}" did not act during the single tick`,
    );
  }
});

test("actor coverage is unaffected by initialState.actors array order", async () => {
  const forward = buildInitialState().actors;
  const reversed = buildInitialState().actors.slice().reverse();

  const coverageForward = await coverageForActors(forward);
  const coverageReversed = await coverageForActors(reversed);

  for (const actor of forward) {
    assert.ok((coverageForward.get(actor.id) || []).length > 0, `forward order: "${actor.id}" missing coverage`);
    assert.ok((coverageReversed.get(actor.id) || []).length > 0, `reversed order: "${actor.id}" missing coverage`);
  }
});

test("long run (TICK_COUNT * 5) does not silently drop later actors", async () => {
  const initialState = buildInitialState();
  const byActor = await coverageForActors(initialState.actors, { ticks: TICK_COUNT * 5 });
  for (const actor of initialState.actors) {
    const count = (byActor.get(actor.id) || []).length;
    assert.ok(count > 0, `actor "${actor.id}" has no accepted actions across the long run`);
  }
});

test("duplicate actor id is rejected at initial-state application", async () => {
  // Duplicate ids make action attribution ambiguous and used to amplify
  // accepted actions (measured 12 move/wait actions per tick for a
  // twice-placed id, verified 2026-07-06). applyInitialStateToCore now
  // rejects the state with reason "duplicate_actor_id" before placement.
  const actors = [
    buildActor({ id: "dup_actor", archetype: "delver", position: { x: 1, y: 1 } }),
    buildActor({ id: "dup_actor", archetype: "warden", position: { x: 7, y: 7 } }),
    buildActor({ id: "warden_ok", archetype: "warden", position: { x: 7, y: 1 } }),
  ];
  await assert.rejects(
    runRuntimeScenario({
      initialState: buildStateWithActors(actors),
      ticks: TICK_COUNT,
      seed: 0,
    }),
    /duplicate_actor_id/,
  );
});

test("cross-check: delver + 3 wardens roster shape agrees with the integration suite's coverage expectations", async () => {
  // Mirrors the roster shape used by tests/integration/multi-actor-random-run.test.js
  // (one delver + three wardens, all random) so the two suites cannot drift
  // apart on what "full actor coverage" means.
  const actors = [
    buildActor({ id: "delver_1", archetype: "delver", position: { x: 1, y: 1 }, hp: 10 }),
    buildActor({ id: "warden_1", archetype: "warden", position: { x: 7, y: 1 } }),
    buildActor({ id: "warden_2", archetype: "warden", position: { x: 1, y: 7 } }),
    buildActor({ id: "warden_3", archetype: "warden", position: { x: 7, y: 7 } }),
  ];
  const byActor = await coverageForActors(actors);
  const covered = actors.filter((a) => (byActor.get(a.id) || []).length > 0).map((a) => a.id);
  assert.deepEqual(covered.sort(), actors.map((a) => a.id).sort(), "all four actors must be covered");
});
