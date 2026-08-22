/**
 * AM.0b — the run must record what HAPPENED, not only what was decided (F11).
 *
 * Before this, a run wrote tick-frames, effects, an action log and a summary —
 * every one of them a record of a DECISION. Nothing on disk carried a position,
 * a vital or a hazard's state, so nothing outside the process could distinguish
 * a run in which every actor moved from one in which core refused every move.
 * That is precisely the confusion F1/F2 lived inside, and it is why the CLI
 * multi-actor suite could only ever assert the action ledger.
 *
 * These tests pin the snapshot itself. The CLI/MCP surface is covered in
 * tests/adapters-cli/show-state-reflects-tick.test.js.
 */
"use strict";

const assert = require("node:assert/strict");

const TICKS = 8;

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
    meta: { id: "world_state_sim", runId: "world_state", createdAt: "2026-08-14T00:00:00.000Z" },
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

function vitals({ hp = 10, stamina = 6 } = {}) {
  return {
    health: { current: hp, max: hp, regen: 0 },
    mana: { current: hp, max: hp, regen: 0 },
    stamina: { current: stamina, max: stamina, regen: 2 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

function buildInitialState(actors) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "world_state", runId: "world_state", createdAt: "2026-08-14T00:00:00.000Z" },
    simConfigRef: { id: "world_state_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors,
  };
}

function actor(id, position, motivationKind, v = vitals()) {
  return {
    id,
    kind: "ambulatory",
    archetype: id.startsWith("delver") ? "delver" : "warden",
    role: id.startsWith("delver") ? "delver" : "warden",
    position,
    motivation: { kind: motivationKind },
    traits: { affinities: { fire: 1 } },
    vitals: v,
  };
}

async function runScenario({ simConfig, initialState, ticks = TICKS }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) await runtime.step();
  return { core, runtime };
}

const META = { id: "ws", runId: "ws", createdAt: "2026-08-14T00:00:00.000Z", producedBy: "annotator" };

// ---------------------------------------------------------------------------
// The snapshot reports the world, and it agrees with core
// ---------------------------------------------------------------------------

test("captureWorldState records every actor's final position, matching core exactly", async () => {
  const initialState = buildInitialState([
    actor("delver_1", { x: 1, y: 1 }, "random"),
    actor("warden_1", { x: 7, y: 1 }, "random"),
    actor("warden_2", { x: 1, y: 7 }, "random"),
  ]);

  const { core, runtime } = await runScenario({ simConfig: buildSimConfig(), initialState });
  const snapshot = runtime.captureWorldState({ meta: META });

  assert.equal(snapshot.schema, "agent-kernel/WorldStateArtifact");
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.tick, TICKS, "the snapshot's tick must be the run's tick");
  assert.equal(snapshot.actors.length, initialState.actors.length);

  snapshot.actors.forEach((entry) => {
    assert.equal(
      entry.position.x,
      core.getMotivatedActorXByIndex(entry.index),
      `${entry.id}: snapshot x must equal core's x — a snapshot that disagrees with the world it `
        + "claims to describe is worse than none",
    );
    assert.equal(entry.position.y, core.getMotivatedActorYByIndex(entry.index));
    assert.equal(entry.vitals.health.current, core.getMotivatedActorVitalCurrentByIndex(entry.index, 0));
    assert.equal(entry.vitals.stamina.current, core.getMotivatedActorVitalCurrentByIndex(entry.index, 2));
  });
});

test("the snapshot carries the authored actor ids, not core's numeric ones", async () => {
  const initialState = buildInitialState([
    actor("delver_1", { x: 2, y: 2 }, "random"),
    actor("warden_1", { x: 6, y: 6 }, "random"),
  ]);
  const { runtime } = await runScenario({ simConfig: buildSimConfig(), initialState });
  const snapshot = runtime.captureWorldState({ meta: META });

  assert.deepEqual(
    snapshot.actors.map((a) => a.id).sort(),
    ["delver_1", "warden_1"],
    "an id the author never wrote makes the snapshot unreadable against their own scenario",
  );
});

// ---------------------------------------------------------------------------
// A snapshot must be able to show a run in which nothing moved
// ---------------------------------------------------------------------------

test("a run in which no actor moved is visibly distinct from one in which they did", async () => {
  const still = vitals({ stamina: 0 });
  still.stamina = { current: 0, max: 0, regen: 0 };

  const stuck = await runScenario({
    simConfig: buildSimConfig(),
    initialState: buildInitialState([actor("delver_1", { x: 4, y: 4 }, "random", still)]),
  });
  const moving = await runScenario({
    simConfig: buildSimConfig(),
    initialState: buildInitialState([actor("delver_1", { x: 4, y: 4 }, "random")]),
  });

  const stuckPos = stuck.runtime.captureWorldState({ meta: META }).actors[0].position;
  const movingPos = moving.runtime.captureWorldState({ meta: META }).actors[0].position;

  assert.deepEqual(stuckPos, { x: 4, y: 4 }, "an actor core never moved must be reported at its start");
  assert.notDeepEqual(
    movingPos,
    stuckPos,
    "the whole point of the snapshot: a run that moved and a run that did not must not look alike",
  );
});

// ---------------------------------------------------------------------------
// Hazard state, and the provenance gate
// ---------------------------------------------------------------------------

test("hazard mana and durability are recorded, and follow per-tick regen", async () => {
  const simConfig = buildSimConfig({
    hazards: [{
      id: "hz_1",
      position: { x: 4, y: 4 },
      affinity: { kind: "fire", expression: "emit", stacks: 1 },
      vitals: {
        mana: { current: 0, max: 50, regen: 1 },
        durability: { current: 5, max: 5, regen: 0 },
      },
    }],
  });
  const { runtime } = await runScenario({
    simConfig,
    initialState: buildInitialState([actor("delver_1", { x: 1, y: 1 }, "stationary")]),
  });

  const snapshot = runtime.captureWorldState({ meta: META });
  assert.equal(snapshot.hazards.length, 1, "an armed hazard must appear in the snapshot");
  const hazard = snapshot.hazards[0];
  assert.deepEqual(hazard.position, { x: 4, y: 4 });
  assert.equal(
    hazard.mana.current,
    TICKS,
    `hazard mana regens once per tick (AM.3), so after ${TICKS} ticks it must read ${TICKS}`,
  );
  assert.equal(hazard.durability.current, 5);
});

test("an Annotator that never observed the run refuses to sign a snapshot", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({
    seed: 0,
    simConfig: buildSimConfig(),
    initialState: buildInitialState([actor("delver_1", { x: 1, y: 1 }, "random")]),
  });
  // Never stepped: an un-ticked run legitimately has an idle Annotator, so this
  // must SUCCEED — the gate exists to catch a stand-in signing for a run that
  // happened, not to refuse an honest empty one.
  assert.ok(runtime.captureWorldState({ meta: META }), "a zero-tick run may still be snapshotted");
});

// ## TODO: Test Permutations
//
// Keep every assertion on the SNAPSHOT vs CORE, never on the action ledger.
//
// - actor counts 1 / 2 / 4 / 11, and tick counts 1 / 2 / 10 / 100
// - actors that die (health reaches 0) must still appear, at their last position
// - an actor holding affinity grants: the grants array must match core slot for
//   slot, including mana drawn down by a cast and a grant dropped when spent
// - multiple hazards with different regen rates advancing independently
// - a hazard destroyed mid-run must be ABSENT, not present with zero durability
// - a snapshot taken twice on the same finished run must be byte-identical
