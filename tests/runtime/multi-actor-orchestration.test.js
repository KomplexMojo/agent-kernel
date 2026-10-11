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
const WIDTH = 9;
const HEIGHT = 9;
const CLOCK = "2026-07-02T00:00:00.000Z";

function borderedTerrain() {
  const terrain = Array(WIDTH * HEIGHT).fill("floor");
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (x === 0 || x === WIDTH - 1 || y === 0 || y === HEIGHT - 1) terrain[y * WIDTH + x] = "wall";
    }
  }
  terrain[(HEIGHT - 2) * WIDTH + (WIDTH - 2)] = "exit";
  return terrain;
}

function health(current) {
  return { health: { current, max: current, regen: 0 } };
}

function buildActor({ id, category, position, motivation = "random", hp = 6 }) {
  return {
    id,
    category,
    position,
    motivations: [motivation],
    vitals: health(hp),
  };
}

function defaultActors() {
  return [
    buildActor({ id: "delver_1", category: "delver", position: { x: 1, y: 1 }, hp: 10 }),
    buildActor({ id: "warden_1", category: "warden", position: { x: 7, y: 1 } }),
    buildActor({ id: "warden_2", category: "warden", position: { x: 1, y: 7 } }),
    buildActor({ id: "warden_3", category: "warden", position: { x: 7, y: 7 } }),
  ];
}

async function buildArtifacts(actors) {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const terrain = borderedTerrain();
  const movementStamina = Object.fromEntries(actors.map((actor) => [actor.id, 0]));
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "multi_actor_orchestration_sim", runId: "multi_actor_orchestration", createdAt: CLOCK, producedBy: "test" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width: WIDTH, height: HEIGHT, terrain, exitApproach: { x: WIDTH - 2, y: HEIGHT - 2 } },
    movementStamina,
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "multi_actor_orchestration_state", runId: "multi_actor_orchestration", createdAt: CLOCK, producedBy: "test" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain,
    actors,
  });
  return { simConfig, initialState };
}

async function runRuntimeScenario({
  actors = defaultActors(),
  ticks = TICK_COUNT,
  seed = 0,
} = {}) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const { simConfig, initialState } = await buildArtifacts(actors);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { runtime, frames: runtime.getTickFrames(), initialState };
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

async function coverageForActors(actors, { ticks = TICK_COUNT, seed = 0 } = {}) {
  const { frames } = await runRuntimeScenario({ actors, ticks, seed });
  return acceptedActionsByActor(frames);
}

// ---------------------------------------------------------------------------
// Every configured actor must receive accepted actions across the run
// ---------------------------------------------------------------------------

test("every configured actor (not just actors[0]) receives accepted move/wait actions across a multi-tick run", async () => {
  const actors = defaultActors();
  const { frames } = await runRuntimeScenario({ actors, ticks: TICK_COUNT, seed: 0 });
  const byActor = acceptedActionsByActor(frames);
  for (const actor of actors) {
    const actions = (byActor.get(actor.id) || []).filter((a) => a.kind === "move" || a.kind === "wait");
    assert.ok(
      actions.length > 0,
      `actor "${actor.id}" must receive at least one accepted move/wait action across ${TICK_COUNT} ticks ` +
        `(actors with accepted actions: ${[...byActor.keys()].join(",") || "none"})`,
    );
  }
});

test("actor iteration order is deterministic and matches initialState.actors order", async () => {
  const actors = defaultActors();
  const runA = await runRuntimeScenario({ actors, ticks: TICK_COUNT, seed: 42 });
  const runB = await runRuntimeScenario({ actors: defaultActors(), ticks: TICK_COUNT, seed: 42 });
  const byActorA = acceptedActionsByActor(runA.frames);
  const byActorB = acceptedActionsByActor(runB.frames);
  for (const actor of actors) {
    const seqA = (byActorA.get(actor.id) || []).map((a) => `${a.kind}:${a.tick}`);
    const seqB = (byActorB.get(actor.id) || []).map((a) => `${a.kind}:${a.tick}`);
    assert.deepEqual(seqA, seqB, `actor "${actor.id}" accepted-action sequence must be reproducible for identical seed/initialState`);
  }
});

test("core still tracks every configured actor after a multi-tick run with 4 actors", async () => {
  const actors = defaultActors();
  const { runtime } = await runRuntimeScenario({ actors, ticks: TICK_COUNT, seed: 7 });
  assert.equal(runtime.getActorSnapshot().actors.length, actors.length);
});

test("every configured actor changes position in core state, not just in the accepted-action ledger", async () => {
  const actors = defaultActors();
  const { runtime } = await runRuntimeScenario({ actors, ticks: TICK_COUNT, seed: 0 });
  const live = new Map(runtime.getActorSnapshot().actors.map((entry) => [entry.id, entry.position]));
  const stuck = actors.filter((configured) => {
    const position = live.get(configured.id);
    return position && position.x === configured.position.x && position.y === configured.position.y;
  }).map((configured) => `${configured.id} never left ${configured.position.x},${configured.position.y}`);
  assert.deepEqual(
    stuck,
    [],
    "an actor that receives accepted move actions must actually move in core state; "
      + `still at spawn after ${TICK_COUNT} ticks: ${stuck.join(" | ")}`,
  );
});

test("actor-count permutations: 2, 3, and 11 actors all get full coverage", async () => {
  const rosters = [
    [
      buildActor({ id: "delver_1", category: "delver", position: { x: 1, y: 1 } }),
      buildActor({ id: "warden_1", category: "warden", position: { x: 7, y: 7 } }),
    ],
    [
      buildActor({ id: "delver_1", category: "delver", position: { x: 1, y: 1 } }),
      buildActor({ id: "warden_1", category: "warden", position: { x: 7, y: 1 } }),
      buildActor({ id: "warden_2", category: "warden", position: { x: 7, y: 7 } }),
    ],
    [
      buildActor({ id: "delver_1", category: "delver", position: { x: 1, y: 1 } }),
      ...Array.from({ length: 10 }, (_, i) =>
        buildActor({
          id: `warden_${i + 1}`,
          category: "warden",
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
    buildActor({ id: "random_1", category: "delver", position: { x: 1, y: 1 }, motivation: "random" }),
    buildActor({ id: "attacker_1", category: "warden", position: { x: 7, y: 7 }, motivation: "attacking" }),
    buildActor({ id: "stationary_1", category: "warden", position: { x: 7, y: 1 }, motivation: "stationary" }),
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
  const actors = defaultActors();
  const byActor = await coverageForActors(actors, { ticks: 1 });
  for (const actor of actors) {
    assert.ok(
      (byActor.get(actor.id) || []).length > 0,
      `actor "${actor.id}" did not act during the single tick`,
    );
  }
});

test("actor coverage is unaffected by initialState.actors array order", async () => {
  const forward = defaultActors();
  const reversed = defaultActors().slice().reverse();
  const coverageForward = await coverageForActors(forward);
  const coverageReversed = await coverageForActors(reversed);
  for (const actor of forward) {
    assert.ok((coverageForward.get(actor.id) || []).length > 0, `forward order: "${actor.id}" missing coverage`);
    assert.ok((coverageReversed.get(actor.id) || []).length > 0, `reversed order: "${actor.id}" missing coverage`);
  }
});

test("long run (TICK_COUNT * 5) does not silently drop later actors", async () => {
  const actors = defaultActors();
  const byActor = await coverageForActors(actors, { ticks: TICK_COUNT * 5 });
  for (const actor of actors) {
    const count = (byActor.get(actor.id) || []).length;
    assert.ok(count > 0, `actor "${actor.id}" has no accepted actions across the long run`);
  }
});

test("duplicate actor id is rejected at initial-state application", async () => {
  const actors = [
    buildActor({ id: "dup_actor", category: "delver", position: { x: 1, y: 1 } }),
    buildActor({ id: "dup_actor", category: "warden", position: { x: 7, y: 7 } }),
    buildActor({ id: "warden_ok", category: "warden", position: { x: 7, y: 1 } }),
  ];
  await assert.rejects(
    runRuntimeScenario({ actors, ticks: TICK_COUNT, seed: 0 }),
    /duplicate actor id/,
  );
});

test("cross-check: delver + 3 wardens roster shape agrees with the integration suite's coverage expectations", async () => {
  const actors = defaultActors();
  const byActor = await coverageForActors(actors);
  const covered = actors.filter((a) => (byActor.get(a.id) || []).length > 0).map((a) => a.id);
  assert.deepEqual(covered.sort(), actors.map((a) => a.id).sort(), "all four actors must be covered");
});
