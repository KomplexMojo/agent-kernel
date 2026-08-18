/**
 * AM.0 — Multi-tick world-state characterization.
 *
 * These tests assert CORE STATE, never `frame.acceptedActions`.
 *
 * Why that distinction is the whole point: the existing multi-actor suites
 * (tests/integration/cli-run-multi-actor-movement.test.js and
 * tests/runtime/multi-actor-orchestration.test.js) assert only that an actor id
 * appears in `acceptedActions`. `applyActionsToCore` in
 * packages/runtime/src/runner/runtime-fsm.mjs pushes a move into
 * `acceptedActions` unconditionally — `applyMoveAction` returns void, and core
 * reports rejection by pushing ActionRejected into the effect ring, which the
 * runtime never reads. So a run in which core rejected every move still reports
 * every actor as having acted, and those suites stay green.
 *
 * Each test below names the finding it pins:
 *
 *   F1  Only actor index 0 can move. `activeMotivatedActorIndex` is fixed at 0
 *       (world.ts applyActorPlacements) and `setActiveMotivatedActor` has no
 *       production caller, so move.ts validateMoveIdentityAndTiming rejects
 *       every move whose actorId is not actor 0's, with WrongActor.
 *   F2  That rejection is invisible to the runtime.
 *   F4  `core.advanceTick()` is called only from move.ts commitMove, so the
 *       tick — and therefore all regen — advances per successful MOVE rather
 *       than per tick.
 *
 * Architecture: runtime + core-ts only. No adapters, no LLM, no external IO.
 */
"use strict";

const assert = require("node:assert/strict");

const TICK_COUNT = 10;

function makeFloorGrid(w, h) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "#" : "."
    ).join("")
  );
}

function buildSimConfig({ width = 9, height = 9, hazards = [] } = {}) {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "multi_tick_world_state_sim",
      runId: "multi_tick_world_state",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width,
        height,
        tiles: makeFloorGrid(width, height),
        spawn: { x: 1, y: 1 },
        exit: { x: width - 2, y: height - 2 },
        rooms: [{ id: "R1", x: 0, y: 0, width, height }],
        hazards,
      },
    },
  };
}

function makeVitals({ hp = 10, regen = 0 } = {}) {
  return {
    health: { current: hp, max: hp, regen },
    mana: { current: hp, max: hp, regen },
    stamina: { current: hp, max: hp, regen },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

function buildInitialState(actors) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "multi_tick_world_state",
      runId: "multi_tick_world_state",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
    simConfigRef: {
      id: "multi_tick_world_state_sim",
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors,
  };
}

function actor(id, position, motivationKind, vitals = makeVitals()) {
  return {
    id,
    kind: "ambulatory",
    archetype: id.startsWith("delver") ? "delver" : "warden",
    role: id.startsWith("delver") ? "delver" : "warden",
    position,
    motivation: { kind: motivationKind },
    traits: { affinities: { fire: 1 } },
    vitals,
  };
}

async function loadRuntimeDeps() {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  return { createRuntime, createCore };
}

/** Same seam the CLI `run` command uses (packages/runtime/src/commands/kernel.js). */
async function runScenario({ simConfig, initialState, ticks = TICK_COUNT, seed = 0 }) {
  const { createRuntime, createCore } = await loadRuntimeDeps();
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { core, runtime, frames: runtime.getTickFrames() };
}

/** Snapshot every motivated actor's position straight out of core. */
function readCorePositions(core) {
  const count = core.getMotivatedActorCount();
  const positions = [];
  for (let i = 0; i < count; i += 1) {
    positions.push({
      x: core.getMotivatedActorXByIndex(i),
      y: core.getMotivatedActorYByIndex(i),
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// F1 / F2 — every actor must actually move in the WORLD, not just in the ledger
// ---------------------------------------------------------------------------

test("every actor's core position changes across a multi-tick run, not just actor index 0", async () => {
  const initialState = buildInitialState([
    actor("delver_1", { x: 1, y: 1 }, "random"),
    actor("warden_1", { x: 7, y: 1 }, "random"),
    actor("warden_2", { x: 1, y: 7 }, "random"),
    actor("warden_3", { x: 7, y: 7 }, "random"),
  ]);

  const { core } = await runScenario({
    simConfig: buildSimConfig(),
    initialState,
    ticks: TICK_COUNT,
  });

  const finalPositions = readCorePositions(core);
  assert.equal(
    finalPositions.length,
    initialState.actors.length,
    "core must track every configured actor",
  );

  const stuck = [];
  initialState.actors.forEach((configured, index) => {
    const final = finalPositions[index];
    const moved = final.x !== configured.position.x || final.y !== configured.position.y;
    if (!moved) stuck.push(`${configured.id} (index ${index}) stayed at ${final.x},${final.y}`);
  });

  assert.deepEqual(
    stuck,
    [],
    `every random-motivation actor must change position in core state across ${TICK_COUNT} ticks. `
      + "Stuck actors indicate core rejected their moves (WrongActor) while the runtime still "
      + `reported them as accepted: ${stuck.join(" | ")}`,
  );
});

// ---------------------------------------------------------------------------
// F4 — the core tick must track the runtime tick, not the move count
// ---------------------------------------------------------------------------

test("core tick equals the number of runtime steps, independent of how many actors moved", async () => {
  // actors[0] is stationary on purpose: at HEAD the core tick only advances
  // inside commitMove, and only actor index 0's moves ever commit. With index 0
  // holding position, nothing advances the tick at all.
  const initialState = buildInitialState([
    actor("delver_1", { x: 4, y: 4 }, "stationary"),
    actor("warden_1", { x: 1, y: 1 }, "random"),
    actor("warden_2", { x: 7, y: 7 }, "random"),
  ]);

  const { core } = await runScenario({
    simConfig: buildSimConfig(),
    initialState,
    ticks: TICK_COUNT,
  });

  assert.equal(
    core.getCurrentTick(),
    TICK_COUNT,
    "core.getCurrentTick() must equal the number of runtime.step() calls — the tick is a property "
      + "of the simulation, not a side effect of a successful move",
  );
});

// ---------------------------------------------------------------------------
// F4 — regen is a per-tick effect, including on a tick in which nothing moved
// ---------------------------------------------------------------------------

test("vital regen applies exactly once per tick, including ticks in which no actor moves", async () => {
  const REGEN = 1;
  const START_HP = 1;
  const MAX_HP = 100;
  const vitals = makeVitals({ hp: START_HP, regen: REGEN });
  vitals.health = { current: START_HP, max: MAX_HP, regen: REGEN };

  // Every actor is stationary: no move commits on any tick, so this isolates
  // tick-driven regen from move-driven regen completely.
  const initialState = buildInitialState([
    actor("delver_1", { x: 2, y: 2 }, "stationary", vitals),
    actor("warden_1", { x: 6, y: 6 }, "stationary", vitals),
  ]);

  const { core } = await runScenario({
    simConfig: buildSimConfig(),
    initialState,
    ticks: TICK_COUNT,
  });

  const expected = START_HP + REGEN * TICK_COUNT;
  for (let index = 0; index < core.getMotivatedActorCount(); index += 1) {
    const health = core.getMotivatedActorVitalCurrentByIndex(index, 0);
    assert.equal(
      health,
      expected,
      `actor index ${index}: health must regen once per tick even with no movement — `
        + `expected ${expected} after ${TICK_COUNT} ticks, got ${health}`,
    );
  }
});

// ---------------------------------------------------------------------------
// F4 — hazard regen must advance through the runtime, not only through a
//      direct core.advanceTick() call (which is all tests/core-ts proves today)
// ---------------------------------------------------------------------------

test("hazard mana regen advances once per tick when driven through the runtime", async () => {
  const HAZARD = { x: 4, y: 4 };
  const MANA_REGEN = 1;
  const simConfig = buildSimConfig({
    hazards: [
      {
        id: "hz_1",
        position: HAZARD,
        affinity: { kind: "fire", expression: "emit", stacks: 1 },
        vitals: {
          mana: { current: 0, max: 50, regen: MANA_REGEN },
          durability: { current: 5, max: 5, regen: 0 },
        },
      },
    ],
  });

  const initialState = buildInitialState([
    actor("delver_1", { x: 1, y: 1 }, "stationary"),
  ]);

  const { core } = await runScenario({ simConfig, initialState, ticks: TICK_COUNT });

  assert.equal(
    core.getStaticHazardAffinityAt(HAZARD.x, HAZARD.y) > 0,
    true,
    "the hazard must be armed in core before its regen can be asserted",
  );
  assert.equal(
    core.getStaticHazardManaReserveAt(HAZARD.x, HAZARD.y),
    MANA_REGEN * TICK_COUNT,
    `hazard mana must regen once per tick through the runtime — expected `
      + `${MANA_REGEN * TICK_COUNT} after ${TICK_COUNT} ticks`,
  );
});

// ---------------------------------------------------------------------------
// AM.1 — a move core REFUSED must be recorded as a rejection, never as accepted
//
// This is the assertion that makes every other test in this file meaningful. If
// it regresses, the runtime goes back to reporting movement that never
// happened, and a suite asserting `acceptedActions` cannot tell the difference.
// ---------------------------------------------------------------------------

test("a move core rejects is recorded in preCoreRejections with its reason, not in acceptedActions", async () => {
  // Stamina 0 with a movement cost of 1: core rejects every move this actor
  // proposes with InsufficientStamina. The actor is `random` so it keeps
  // proposing them.
  const noStamina = makeVitals({ hp: 10, regen: 0 });
  noStamina.stamina = { current: 0, max: 0, regen: 0 };

  const initialState = buildInitialState([
    actor("delver_1", { x: 4, y: 4 }, "random", noStamina),
  ]);

  const { runtime, core } = await runScenario({
    simConfig: buildSimConfig(),
    initialState,
    ticks: TICK_COUNT,
  });

  const frames = runtime.getTickFrames();
  const acceptedMoves = [];
  const rejectedMoves = [];
  for (const frame of frames) {
    for (const a of frame?.acceptedActions || []) {
      if (a?.kind === "move") acceptedMoves.push(a);
    }
    for (const r of frame?.preCoreRejections || []) {
      if (r?.action?.kind === "move") rejectedMoves.push(r);
    }
  }

  assert.equal(
    acceptedMoves.length,
    0,
    `core refused every move (stamina 0), so none may be reported as accepted — `
      + `saw ${acceptedMoves.length}`,
  );
  assert.ok(
    rejectedMoves.length > 0,
    "the refused moves must be recorded as rejections, not silently dropped",
  );
  assert.ok(
    rejectedMoves.every((r) => String(r.reason).includes("InsufficientStamina")),
    "each rejection must carry core's own reason name, so the cause is readable "
      + `without re-deriving it — saw: ${[...new Set(rejectedMoves.map((r) => r.reason))].join(", ")}`,
  );
  // And the world agrees with the ledger: the actor never moved.
  assert.equal(core.getMotivatedActorXByIndex(0), 4, "a refused move must not change position");
  assert.equal(core.getMotivatedActorYByIndex(0), 4, "a refused move must not change position");
});

// ## TODO: Test Permutations
//
// Expand each of the four cases above along these axes. Keep every assertion on
// CORE STATE — an assertion on `frame.acceptedActions` defeats the purpose of
// this file and must not be added here.
//
// - actor counts: 1, 2, 4, 8, 11 (11 matches the acceptance-scale roster in
//   tests/integration/cli-run-multi-actor-movement.test.js)
// - tick counts: 1 (boundary), 2, 10, 100
// - motivation mixes: all-random, all-stationary, one-stationary-rest-random,
//   one-random-rest-stationary, attacking + defending pairs
// - actor-order permutations: the same roster with initialState.actors reversed
//   must produce the same per-actor movement coverage
// - regen permutations: regen 0 (no growth), regen > max-current (clamps at
//   max, never overshoots), regen on stamina and mana as well as health
// - hazard permutations: mana regen 0 (static reserve), durability regen,
//   a destroyed hazard (must stay destroyed across ticks), two hazards with
//   different regen rates advancing independently
