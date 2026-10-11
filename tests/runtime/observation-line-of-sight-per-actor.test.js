/**
 * DS6.1 — runtime supplies core's perception transform with live tile geometry
 * and the surviving dark field at potential targets. The Actor receives the
 * narrowed result; runtime glue does not reimplement visibility policy.
 */
"use strict";

const assert = require("node:assert/strict");

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

function floorTerrain(width, height, walls = []) {
  const terrain = Array(width * height).fill("floor");
  for (const { x, y } of walls) terrain[y * width + x] = "wall";
  return terrain;
}

function health(id, category, position, extras = {}) {
  return {
    id,
    category,
    position,
    motivations: ["stationary"],
    vitals: { health: { current: 10, max: 10, regen: 0 } },
    ...extras,
  };
}

async function buildArtifacts({ width = 7, height = 5, walls = [], actors }) {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => "2026-09-16T00:00:00.000Z" });
  const terrain = floorTerrain(width, height, walls);
  const movementStamina = Object.fromEntries(
    actors.filter((actor) => actor.category === "delver" || actor.category === "warden")
      .map((actor) => [actor.id, 1]),
  );
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "ds6_sim", runId: "ds6", createdAt: "2026-09-16T00:00:00.000Z", producedBy: "test" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width, height, terrain },
    movementStamina,
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "ds6_state", runId: "ds6", createdAt: "2026-09-16T00:00:00.000Z", producedBy: "test" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width, height },
    terrain,
    actors,
  });
  return { simConfig, initialState };
}

async function captureDecideObservations({ actors, walls = [], extraActors = [] }) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const captured = [];
  const { simConfig, initialState } = await buildArtifacts({
    walls,
    actors: [...actors, ...extraActors],
  });
  const runtime = createRuntime({
    core: createCore(),
    adapters: {},
    personas: { actor: captureDecidePersona(captured) },
  });
  await runtime.init({ seed: 0, simConfig, initialState });
  await runtime.step();
  assert.ok(captured.length > 0, "the Actor persona must receive a scoped observation");
  return captured;
}

function observerAndTarget(targetPosition, extras = {}) {
  return [
    health("observer", "delver", { x: 1, y: 2 }),
    health("target", "warden", targetPosition, extras),
  ];
}

async function assertOpaqueHides({ walls = [], extraActors = [], expectedIds = ["observer"] }) {
  const captured = await captureDecideObservations({
    walls,
    actors: observerAndTarget({ x: 3, y: 2 }),
    extraActors,
  });
  const observation = captured.find((entry) => entry.actorId === "observer")?.observation
    ?? captured[0].observation;
  assert.deepEqual(observation.actors.map((entry) => entry.id).sort(), [...expectedIds].sort());
  assert.equal(Object.hasOwn(observation, "hazards"), false);
}

test("runtime hides actors behind a live core wall", async () => {
  await assertOpaqueHides({ walls: [{ x: 2, y: 2 }] });
});

test("runtime hides actors behind a live core barrier", async () => {
  await assertOpaqueHides({
    extraActors: [{
      id: "gate",
      category: "barrier",
      position: { x: 2, y: 2 },
      motivations: [],
      vitals: { durability: { current: 5, max: 5, regen: 0 } },
    }],
    expectedIds: ["gate", "observer"],
  });
});

test("runtime conceals a distant target standing in surviving dark", async () => {
  const captured = await captureDecideObservations({
    actors: observerAndTarget({ x: 3, y: 2 }, {
      affinities: [{ kind: "dark", expression: "emit", stacks: 2 }],
      activeAffinityKey: "dark:emit",
    }),
  });
  const observation = captured.find((entry) => entry.actorId === "observer")?.observation
    ?? captured[0].observation;
  assert.deepEqual(observation.actors.map((entry) => entry.id), ["observer"]);
  assert.equal(Object.hasOwn(observation, "hazards"), false);
});

test("runtime exposes a perceived canonical field cell", async () => {
  const captured = await captureDecideObservations({
    actors: observerAndTarget({ x: 2, y: 2 }, {
      affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
      activeAffinityKey: "fire:emit",
    }),
  });
  const observation = captured.find((entry) => entry.actorId === "observer")?.observation
    ?? captured[0].observation;
  assert.ok(
    observation.affinityFields.some((entry) => (
      entry.position.x === 2 && entry.position.y === 2 && entry.kind === "fire" && entry.stacks === 2
    )),
    "the Actor must receive the core's canonical field record rather than reconstructing one from a source",
  );
  assert.equal(Object.hasOwn(observation, "hazards"), false);
});

test("two actors receive different scoped views from the same snapshot", async () => {
  const captured = await captureDecideObservations({
    walls: [{ x: 2, y: 2 }],
    actors: [
      ...observerAndTarget({ x: 3, y: 2 }),
      health("near_target", "warden", { x: 4, y: 2 }),
    ],
  });
  const byActor = new Map(captured.map((entry) => [entry.actorId, entry.observation]));
  assert.deepEqual(byActor.get("observer").actors.map((entry) => entry.id), ["observer"]);
  assert.deepEqual(
    byActor.get("target").actors.map((entry) => entry.id).sort(),
    ["near_target", "target"],
  );
  assert.equal(Object.hasOwn(byActor.get("observer"), "hazards"), false);
});

// ## TODO: Test Permutations
//
// - a target under one dark stack remains visible
// - a target under two dark stacks is still visible when adjacent
// - light/dark cancellation is honored from core's surviving field values
// - actor order does not change which observer gets which scoped payload
