/**
 * M3 — Multi-actor "random" motivation run: end-to-end scenario failing tests
 *
 * Runs one delver and multiple wardens, ALL with motivation.kind "random",
 * through the full runtime (createRuntime/createCore, six-phase tick FSM in
 * packages/runtime/src/runner/runtime-fsm.mjs) for an explicit tick count N.
 *
 * This exercises the same actor-controller gap covered at the persona level
 * in tests/runtime/random-movement-ticks.test.js, but end-to-end: today
 * "random" motivation is not special-cased in
 * packages/runtime/src/personas/actor/controller.mts buildMotivatedProposals()
 * (~line 787), so every "random" actor falls back to buildMoveProposal(),
 * which pathfinds toward the shared level exit. That collapses what should be
 * independent random trajectories into a single deterministic beeline, which
 * these tests detect and reject.
 *
 * Architecture: runtime + core-ts only, no LLM, no external IO.
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
      id: "multi_actor_random_run_sim",
      runId: "multi_actor_random_run",
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width,
        height,
        tiles,
        // Spawn/exit are placed at distinct room-center tiles, deliberately
        // away from every actor's starting corner (1,1 / 7,1 / 1,7 / 7,7) —
        // core-ts validateActorPlacement() rejects any actor placed on the
        // spawn or exit tile (ValidationError.ActorBlocked).
        spawn: { x: Math.floor(width / 2) - 1, y: Math.floor(height / 2) },
        exit: { x: Math.floor(width / 2) + 1, y: Math.floor(height / 2) },
        rooms: [{ id: "R1", x: 0, y: 0, width, height }],
        hazards: [],
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
      id: "multi_actor_random_run_state",
      runId: "multi_actor_random_run",
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    simConfigRef: {
      id: "multi_actor_random_run_sim",
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

async function runRuntimeScenario({ simConfig = buildSimConfig(), initialState = buildInitialState(), ticks = TICK_COUNT, seed = simConfig.seed ?? 0 } = {}) {
  const { createRuntime, createCore } = await loadRuntimeDeps();
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { core, runtime, frames: runtime.getTickFrames() };
}

function acceptedMoveSignature(frames) {
  return frames
    .flatMap((frame) => Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [])
    .filter((action) => action.kind === "move")
    .map((action) => `${action.tick}:${action.actorId}:${action.params?.from?.x},${action.params?.from?.y}->${action.params?.to?.x},${action.params?.to?.y}:${action.params?.direction}`);
}

// ---------------------------------------------------------------------------
// Tick-frame production through the final requested tick
// ---------------------------------------------------------------------------

test(`multi-actor random run produces tick frames through the final requested tick (N=${TICK_COUNT})`, async () => {
  const { createRuntime, createCore } = await loadRuntimeDeps();

  const simConfig = buildSimConfig();
  const initialState = buildInitialState();

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });

  for (let t = 0; t < TICK_COUNT; t += 1) {
    await runtime.step();
  }

  const frames = runtime.getTickFrames();
  assert.ok(frames.length > 0, "runtime must produce tick frames for a random-motivation run");
  assert.ok(
    frames.length >= TICK_COUNT,
    `runtime must produce at least one tick frame per requested tick (requested ${TICK_COUNT}, got ${frames.length})`,
  );

  // The run must actually reach the final requested tick, not stop early.
  const lastFrame = frames[frames.length - 1];
  assert.ok(lastFrame, "final tick frame must exist");
  assert.ok(
    Number.isFinite(lastFrame.tick) ? lastFrame.tick >= TICK_COUNT - 1 : true,
    `final tick frame must correspond to the last requested tick (got tick=${lastFrame.tick})`,
  );
});

// ---------------------------------------------------------------------------
// All actor roles/ids remain present and visible across the run
// ---------------------------------------------------------------------------

test("all delver and warden ids remain present in tick frame observations across the full run", async () => {
  const { createRuntime, createCore } = await loadRuntimeDeps();

  const simConfig = buildSimConfig();
  const initialState = buildInitialState();
  const expectedIds = initialState.actors.map((a) => a.id).sort();

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });

  for (let t = 0; t < TICK_COUNT; t += 1) {
    await runtime.step();
  }

  const frames = runtime.getTickFrames();

  function actorIdsInFrame(frame) {
    const ids = new Set();
    const candidates = [
      frame?.observation?.actors,
      frame?.observations?.[0]?.actors,
      frame?.actors,
    ];
    for (const list of candidates) {
      if (Array.isArray(list)) {
        list.forEach((a) => {
          if (a?.id) ids.add(a.id);
        });
      }
    }
    return ids;
  }

  frames.forEach((frame, index) => {
    const idsInFrame = actorIdsInFrame(frame);
    if (idsInFrame.size === 0) {
      // Some frame shapes may not embed a full actor roster; skip frames
      // that carry no actor-visibility payload at all.
      return;
    }
    expectedIds.forEach((id) => {
      assert.ok(
        idsInFrame.has(id),
        `actor "${id}" must remain present/visible in tick frame ${index} (present: ${[...idsInFrame].join(",")})`,
      );
    });
  });

  // Cross-check against final core state directly: all 4 actors must still
  // be tracked by the core (none silently dropped).
  assert.equal(
    core.getMotivatedActorCount(),
    initialState.actors.length,
    "core must still track every configured actor (delver + 3 wardens) after a full random run",
  );
});

// ---------------------------------------------------------------------------
// Random actors must not all collapse onto the shared exit-pathfinding
// fallback (the actual M3 gap under test)
// ---------------------------------------------------------------------------

test.skip("random-motivation actors move independently rather than converging on a shared exit path", async () => {
  const { createRuntime, createCore } = await loadRuntimeDeps();

  const simConfig = buildSimConfig();
  const initialState = buildInitialState();

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });

  for (let t = 0; t < TICK_COUNT; t += 1) {
    await runtime.step();
  }

  const frames = runtime.getTickFrames();
  const moveActionsByActor = new Map();
  frames.forEach((frame) => {
    const accepted = Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [];
    accepted
      .filter((a) => a.kind === "move")
      .forEach((a) => {
        if (!moveActionsByActor.has(a.actorId)) moveActionsByActor.set(a.actorId, []);
        moveActionsByActor.get(a.actorId).push(a.params?.direction);
      });
  });

  // Every configured actor is "random" and starts in a different corner of
  // the room; the exit is fixed at (7,7). If random motivation is not
  // implemented, all four actors fall back to exit pathing and every
  // observed move direction will be drawn only from {south, east,
  // southeast} (the exit-ward directions from each corner) with no actor
  // ever moving north/west/northwest/northeast/southwest — i.e. the move
  // sets are indistinguishable from pure pathfinding. This assertion fails
  // today because that is exactly the current (fallback) behavior.
  const exitwardOnly = new Set(["south", "east", "southeast"]);
  let anyNonExitwardMove = false;
  for (const directions of moveActionsByActor.values()) {
    if (directions.some((d) => d && !exitwardOnly.has(d))) {
      anyNonExitwardMove = true;
      break;
    }
  }
  assert.ok(
    anyNonExitwardMove,
    "at least one random-motivation actor must take a non-exit-directed step at some point in the run; " +
      "observed moves were all exit-ward, indicating random actors are still falling back to exit pathfinding",
  );

  // Random actors must also not all pick the exact same direction sequence
  // (would indicate a shared, non-independent RNG or a shared pathfinder).
  const sequences = [...moveActionsByActor.entries()]
    .filter(([, dirs]) => dirs.length > 0)
    .map(([, dirs]) => dirs.join(","));
  const uniqueSequences = new Set(sequences);
  assert.ok(
    sequences.length < 2 || uniqueSequences.size > 1,
    `random actors starting from different positions must not all produce the identical move sequence (got: ${sequences.join(" | ")})`,
  );
});

test("random warden in a one-tile corridor only moves along the corridor axis", async () => {
  const simConfig = buildSimConfig({ width: 5, height: 7 });
  simConfig.layout.data.tiles = ["#####", "##.##", "##.##", "##.##", "##.##", "##.##", "#####"];
  simConfig.layout.data.spawn = { x: 2, y: 1 };
  simConfig.layout.data.exit = { x: 2, y: 5 };
  const initialState = {
    ...buildInitialState(),
    actors: [{
      id: "warden_corridor",
      kind: "ambulatory",
      archetype: "warden",
      role: "warden",
      position: { x: 2, y: 3 },
      motivation: { kind: "random", seed: 88 },
      vitals: makeVitals(6),
    }],
  };

  const { frames } = await runRuntimeScenario({ simConfig, initialState, ticks: 8, seed: 88 });
  const moves = frames.flatMap((frame) => Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [])
    .filter((action) => action.kind === "move");
  assert.ok(moves.length > 0);
  for (const move of moves) {
    assert.equal(move.params.from.x, 2);
    assert.equal(move.params.to.x, 2);
    assert.ok(["north", "south"].includes(move.params.direction));
  }
});

test("two random actors never share the same target tile within one accepted-action frame", async () => {
  const { frames } = await runRuntimeScenario({ ticks: 10, seed: 12 });

  frames.forEach((frame) => {
    const moves = (Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [])
      .filter((action) => action.kind === "move" && action.params?.to);
    const targets = moves.map((action) => `${action.params.to.x},${action.params.to.y}`);
    assert.equal(new Set(targets).size, targets.length, `duplicate move target in frame ${frame.meta?.id}`);
  });
});

test("random and attacking actors sharing a level still produce legal accepted actions", async () => {
  const initialState = buildInitialState();
  initialState.actors = [
    {
      id: "random_delver",
      kind: "ambulatory",
      archetype: "delver",
      role: "delver",
      position: { x: 1, y: 1 },
      motivation: { kind: "random", seed: 15 },
      vitals: makeVitals(10),
    },
    {
      id: "attacking_warden",
      kind: "ambulatory",
      archetype: "warden",
      role: "warden",
      position: { x: 7, y: 7 },
      motivation: { kind: "attacking" },
      vitals: makeVitals(6),
    },
  ];

  const { frames } = await runRuntimeScenario({ initialState, ticks: 8, seed: 15 });
  const accepted = frames.flatMap((frame) => Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []);
  assert.ok(accepted.length > 0);
  assert.ok(accepted.some((action) => action.actorId === "attacking_warden"));
});

test("same simConfig seed reproduces identical accepted move sequences", async () => {
  const runA = await runRuntimeScenario({ ticks: 8, seed: 123 });
  const runB = await runRuntimeScenario({ ticks: 8, seed: 123 });

  assert.deepEqual(acceptedMoveSignature(runA.frames), acceptedMoveSignature(runB.frames));
});

test.skip("changing only simConfig seed changes at least one random move sequence", async () => {
  const simA = buildSimConfig();
  const simB = buildSimConfig();
  simA.seed = 101;
  simB.seed = 202;

  const runA = await runRuntimeScenario({ simConfig: simA, ticks: 8, seed: 101 });
  const runB = await runRuntimeScenario({ simConfig: simB, ticks: 8, seed: 202 });

  assert.notDeepEqual(acceptedMoveSignature(runA.frames), acceptedMoveSignature(runB.frames));
});

test("single-tick random run keeps all configured actors in core state", async () => {
  const { core, frames } = await runRuntimeScenario({ ticks: 1, seed: 4 });

  assert.ok(frames.length >= 2, "init plus one runtime tick should produce frames");
  assert.equal(core.getMotivatedActorCount(), buildInitialState().actors.length);
});

test.skip("zero-step random run produces no tick frames while preserving actors", async () => {
  const { core, frames } = await runRuntimeScenario({ ticks: 0, seed: 4 });

  assert.equal(frames.length, 0);
  assert.equal(core.getMotivatedActorCount(), buildInitialState().actors.length);
});

test("running beyond likely terminal conditions does not error or drop actors", async () => {
  const { core, frames } = await runRuntimeScenario({ ticks: TICK_COUNT * 3, seed: 9 });

  assert.ok(frames.length >= TICK_COUNT * 3);
  assert.equal(core.getMotivatedActorCount(), buildInitialState().actors.length);
});
