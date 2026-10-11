/**
 * AM.0 — Multi-tick world-state characterization.
 *
 * These tests assert REGISTRY STATE, never `frame.acceptedActions`.
 *
 * Why that distinction is the whole point: the existing multi-actor suites
 * (tests/integration/cli-run-multi-actor-movement.test.js and
 * tests/runtime/multi-actor-orchestration.test.js) assert only that an actor id
 * appears in `acceptedActions`. A run in which core rejected every move still
 * reports every actor as having acted, and those suites stay green.
 *
 * Each test below names the finding it pins:
 *
 *   F1  Only actor index 0 can move. Leftover world.ts `activeMotivatedActorIndex`
 *       is unused on the unified registry path; every living actor must move.
 *   F2  That rejection is invisible to the runtime.
 *   F4  Tick-close regen used to run only from move.ts commitMove. Unified
 *       ActorTurn.regenerate() runs once per tick after ordered actions.
 *
 * Architecture: runtime + core-ts only. No adapters, no LLM, no external IO.
 */
"use strict";

const assert = require("node:assert/strict");

const TICK_COUNT = 10;
const CLOCK = "2026-08-14T00:00:00.000Z";

async function artifacts(actors, { width = 9, height = 9, movementStamina } = {}) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[(height - 2) * width + (width - 2)] = "exit";
  return buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "multi_tick_world_state",
    clock: CLOCK,
    actors,
    movementStamina,
  });
}

function makeVitals({ hp = 10, regen = 0 } = {}) {
  return {
    health: { current: hp, max: hp, regen },
    mana: { current: hp, max: hp, regen },
    stamina: { current: hp, max: hp, regen },
  };
}

function actor(id, position, motivationKind, vitals = makeVitals()) {
  return {
    id,
    category: id.startsWith("delver") ? "delver" : "warden",
    position,
    motivations: [motivationKind],
    vitals,
  };
}

async function runScenario({ actors, ticks = TICK_COUNT, seed = 0, movementStamina } = {}) {
  const { simConfig, initialState } = await artifacts(actors, { movementStamina });
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { runtime, frames: runtime.getTickFrames(), snapshot: runtime.getActorSnapshot() };
}

function readPositions(snapshot) {
  return snapshot.actors
    .filter((entry) => entry.capabilities?.canMove)
    .map((entry) => ({ id: entry.id, x: entry.position.x, y: entry.position.y }));
}

function runtimeTick(frames) {
  return Math.max(0, ...frames.map((frame) => frame.tick).filter((value) => Number.isFinite(value)));
}

// ---------------------------------------------------------------------------
// F1 / F2 — every actor must actually move in the WORLD, not just in the ledger
// ---------------------------------------------------------------------------

test("every actor's core position changes across a multi-tick run, not just actor index 0", async () => {
  const actors = [
    actor("delver_1", { x: 1, y: 1 }, "random"),
    actor("warden_1", { x: 7, y: 1 }, "random"),
    actor("warden_2", { x: 1, y: 7 }, "random"),
    actor("warden_3", { x: 7, y: 7 }, "random"),
  ];
  const { snapshot } = await runScenario({ actors, ticks: TICK_COUNT });
  const finalPositions = readPositions(snapshot);
  assert.equal(finalPositions.length, actors.length, "registry must track every configured mobile actor");

  const stuck = [];
  for (const configured of actors) {
    const final = finalPositions.find((entry) => entry.id === configured.id);
    const moved = final && (final.x !== configured.position.x || final.y !== configured.position.y);
    if (!moved) stuck.push(`${configured.id} stayed at ${final?.x},${final?.y}`);
  }

  assert.deepEqual(
    stuck,
    [],
    `every random-motivation actor must change position in registry state across ${TICK_COUNT} ticks. `
      + "Stuck actors indicate rejected moves while the runtime still reported them as accepted: "
      + stuck.join(" | "),
  );
});

// ---------------------------------------------------------------------------
// F4 — the runtime tick must track the number of steps, not the move count
// ---------------------------------------------------------------------------

test("core tick equals the number of runtime steps, independent of how many actors moved", async () => {
  const { frames } = await runScenario({
    actors: [
      actor("delver_1", { x: 4, y: 4 }, "stationary"),
      actor("warden_1", { x: 1, y: 1 }, "random"),
      actor("warden_2", { x: 7, y: 7 }, "random"),
    ],
    ticks: TICK_COUNT,
  });

  assert.equal(
    runtimeTick(frames),
    TICK_COUNT,
    "the last recorded tick must equal the number of runtime.step() calls — the tick is a property "
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

  const { snapshot } = await runScenario({
    actors: [
      actor("delver_1", { x: 2, y: 2 }, "stationary", vitals),
      actor("warden_1", { x: 6, y: 6 }, "stationary", { ...vitals, health: { ...vitals.health } }),
    ],
    ticks: TICK_COUNT,
  });

  const expected = START_HP + REGEN * TICK_COUNT;
  for (const entry of snapshot.actors) {
    assert.equal(
      entry.vitals.health.current,
      expected,
      `${entry.id}: health must regen once per tick even with no movement — `
        + `expected ${expected} after ${TICK_COUNT} ticks, got ${entry.vitals.health.current}`,
    );
  }
});

// ---------------------------------------------------------------------------
// F4 — hazard regen must advance through the runtime ActorTurn, not world.ts
// ---------------------------------------------------------------------------

test("hazard mana regen advances once per tick when driven through the runtime", async () => {
  const HAZARD = { x: 4, y: 4 };
  const MANA_REGEN = 1;
  const { snapshot } = await runScenario({
    actors: [
      actor("delver_1", { x: 1, y: 1 }, "stationary"),
      {
        id: "hz_1",
        category: "hazard",
        position: HAZARD,
        affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
        activeAffinityKey: "fire:emit",
        vitals: {
          mana: { current: 0, max: 50, regen: MANA_REGEN },
          durability: { current: 5, max: 5, regen: 0 },
        },
      },
    ],
    ticks: TICK_COUNT,
  });

  const hazard = snapshot.actors.find((entry) => entry.id === "hz_1");
  assert.equal(hazard?.lifecycle, "alive", "the hazard must remain in the registry before its regen can be asserted");
  assert.ok(hazard.affinities.some((pair) => pair.kind === "fire"), "the hazard must keep its authored affinity");
  assert.equal(
    hazard.vitals.mana.current,
    MANA_REGEN * TICK_COUNT,
    `hazard mana must regen once per tick through the runtime — expected `
      + `${MANA_REGEN * TICK_COUNT} after ${TICK_COUNT} ticks`,
  );
});

// ---------------------------------------------------------------------------
// AM.1 — a move core REFUSED must be recorded as a rejection, never as accepted
// ---------------------------------------------------------------------------

test("a move core rejects is recorded in preCoreRejections with its reason, not in acceptedActions", async () => {
  const noStamina = makeVitals({ hp: 10, regen: 0 });
  noStamina.stamina = { current: 0, max: 0, regen: 0 };

  const { runtime, snapshot } = await runScenario({
    actors: [actor("delver_1", { x: 4, y: 4 }, "random", noStamina)],
    ticks: TICK_COUNT,
    movementStamina: { delver_1: 1 },
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
    rejectedMoves.every((r) => r.reason === "actor_action_rejected_by_core:InsufficientStamina"),
    "each rejection must carry core's own reason name, so the cause is readable "
      + `without re-deriving it — saw: ${[...new Set(rejectedMoves.map((r) => r.reason))].join(", ")}`,
  );
  const delver = snapshot.actors.find((entry) => entry.id === "delver_1");
  assert.equal(delver.position.x, 4, "a refused move must not change position");
  assert.equal(delver.position.y, 4, "a refused move must not change position");
});

// ## TODO: Test Permutations
//
// Expand each of the four cases above along these axes. Keep every assertion on
// REGISTRY STATE — an assertion on `frame.acceptedActions` defeats the purpose of
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
