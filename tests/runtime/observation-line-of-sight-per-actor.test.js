/**
 * DS6.1 — runtime supplies core's perception transform with live tile geometry
 * and the surviving dark field at potential targets. The Actor receives the
 * narrowed result; runtime glue does not reimplement visibility policy.
 */
"use strict";

const assert = require("node:assert/strict");

function captureObservationPersona(captured) {
  return {
    subscribePhases: ["observe"],
    view() {
      return { state: "idle", context: {} };
    },
    advance({ payload }) {
      if (payload?.observation) captured.push(payload.observation);
      return { state: "idle", context: {}, actions: [], effects: [], telemetry: null };
    },
  };
}

function captureDecidePersona(captured) {
  return {
    subscribePhases: ["decide"],
    view() {
      return { state: "idle", context: {} };
    },
    advance({ payload }) {
      if (payload?.observation) {
        captured.push({ actorId: payload.actorId, observation: payload.observation });
      }
      return { state: "idle", context: {}, actions: [], effects: [], telemetry: null };
    },
  };
}

function makeVitals() {
  return {
    health: { current: 10, max: 10, regen: 0 },
    mana: { current: 10, max: 10, regen: 0 },
    stamina: { current: 10, max: 10, regen: 0 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

function makeInitialState(targetPosition) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "ds6_state", runId: "ds6", createdAt: "2026-08-27T00:00:00.000Z" },
    simConfigRef: { id: "ds6_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors: [
      {
        id: "observer",
        kind: "ambulatory",
        archetype: "delver",
        position: { x: 1, y: 2 },
        motivation: { kind: "stationary" },
        vitals: makeVitals(),
      },
      {
        id: "target",
        kind: "ambulatory",
        archetype: "warden",
        position: targetPosition,
        motivation: { kind: "stationary" },
        vitals: makeVitals(),
      },
    ],
  };
}

function makeSimConfig(tiles, hazards = []) {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "ds6_sim", runId: "ds6", createdAt: "2026-08-27T00:00:00.000Z" },
    layout: {
      kind: "grid",
      data: {
        width: 7,
        height: 5,
        tiles,
        spawn: { x: 1, y: 2 },
        exit: { x: 5, y: 2 },
        rooms: [{ id: "R1", x: 0, y: 0, width: 7, height: 5 }],
        hazards,
      },
    },
  };
}

async function captureFirstObservation({ simConfig, initialState, configureCore }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const observations = [];
  const core = createCore();
  configureCore?.(core);
  const runtime = createRuntime({
    core,
    adapters: {},
    personas: { actor: captureObservationPersona(observations) },
  });
  await runtime.init({ seed: 0, simConfig, initialState });
  await runtime.step();
  assert.ok(observations.length > 0, "the Actor persona must receive an observation");
  return observations[0];
}

async function assertOpaqueTileHides(tileCharacter) {
  const row = `..${tileCharacter}....`;
  const observation = await captureFirstObservation({
    simConfig: makeSimConfig(
      [".......", ".......", row, ".......", "......."],
      [{ x: 4, y: 2, blocking: false, affinity: { kind: "fire", expression: "emit", stacks: 1 } }],
    ),
    initialState: makeInitialState({ x: 3, y: 2 }),
  });

  assert.deepEqual(observation.actors.map((entry) => entry.id), ["observer"]);
  assert.deepEqual(observation.hazards, []);
  assert.equal("resources" in observation, false, "visibility must not invent a resource observation");
}

test("runtime hides actors and hazards behind a live core wall", async () => {
  await assertOpaqueTileHides("#");
});

test("runtime hides actors and hazards behind a live core barrier", async () => {
  await assertOpaqueTileHides("B");
});

test("runtime passes target dark stacks to core's perception transform", async () => {
  const observation = await captureFirstObservation({
    simConfig: makeSimConfig([".......", ".......", ".......", ".......", "......."]),
    initialState: makeInitialState({ x: 3, y: 2 }),
    configureCore(core) {
      const original = core.getAffinityFieldStacksAt.bind(core);
      core.getAffinityFieldStacksAt = (x, y, kind) => (
        x === 3 && y === 2 && kind === 10 ? 2 : original(x, y, kind)
      );
    },
  });

  assert.deepEqual(observation.actors.map((entry) => entry.id), ["observer"]);
});

test("two actors receive different scoped views from the same snapshot", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const captured = [];
  const initialState = makeInitialState({ x: 3, y: 2 });
  initialState.actors.push({
    id: "near_target",
    kind: "ambulatory",
    archetype: "warden",
    position: { x: 4, y: 2 },
    motivation: { kind: "stationary" },
    vitals: makeVitals(),
  });
  const runtime = createRuntime({
    core: createCore(),
    adapters: {},
    personas: { actor: captureDecidePersona(captured) },
  });
  await runtime.init({
    seed: 0,
    simConfig: makeSimConfig([".......", ".......", "..#....", ".......", "......."]),
    initialState,
  });
  await runtime.step();

  const byActor = new Map(captured.map((entry) => [entry.actorId, entry.observation]));
  assert.deepEqual(byActor.get("observer").actors.map((entry) => entry.id), ["observer"]);
  assert.deepEqual(
    byActor.get("target").actors.map((entry) => entry.id).sort(),
    ["near_target", "target"],
  );
});

// ## TODO: Test Permutations
//
// - a target under one dark stack remains visible
// - a target under two dark stacks is still visible when adjacent
// - light/dark cancellation is honored from core's surviving field values
// - actor order does not change which observer gets which scoped payload
