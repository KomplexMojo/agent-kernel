/**
 * AM.0b — the run must record what HAPPENED, not only what was decided (F11).
 *
 * Unified snapshots copy the live registry. Hazard and resource cells are actors
 * in that list. These tests pin the runtime seam that asks the observing Annotator
 * to sign that copy.
 */
"use strict";

const assert = require("node:assert/strict");

const CLOCK = "2026-08-14T00:00:00.000Z";
const TICKS = 8;
const META = { id: "ws", runId: "ws", createdAt: CLOCK, producedBy: "annotator" };

async function artifacts({ walkerMotivation = "exploring", stamina = 6 } = {}) {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const layout = {
    width: 5,
    height: 1,
    terrain: ["floor", "floor", "floor", "floor", "exit"],
    exitApproach: { x: 3, y: 0 },
  };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "world_state_sim", runId: "world_state", createdAt: CLOCK },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { walker: 1 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "world_state", runId: "world_state", createdAt: CLOCK },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 5, height: 1 },
    terrain: layout.terrain,
    actors: [
      {
        id: "walker",
        category: "delver",
        position: { x: 0, y: 0 },
        motivations: [walkerMotivation],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          stamina: { current: stamina, max: stamina, regen: 0 },
        },
      },
      {
        id: "flame",
        category: "hazard",
        position: { x: 3, y: 0 },
        vitals: {
          durability: { current: 5, max: 5, regen: 0 },
          mana: { current: 0, max: 50, regen: 1 },
        },
        affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
        activeAffinityKey: "fire:emit",
      },
    ],
  });
  return { simConfig, initialState };
}

async function runScenario(options = {}) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, ...(await artifacts(options)) });
  for (let t = 0; t < (options.ticks ?? TICKS); t += 1) await runtime.step();
  return runtime;
}

test("captureWorldState records every actor's final position, matching the registry", async () => {
  const runtime = await runScenario();
  const snapshot = runtime.captureWorldState({ meta: META });
  const live = runtime.getActorSnapshot();

  assert.equal(snapshot.schema, "agent-kernel/WorldStateArtifact");
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.tick, TICKS);
  assert.deepEqual(snapshot.actors, live.actors);
  assert.equal(Object.hasOwn(snapshot, "hazards"), false);
});

test("the snapshot carries the authored actor ids, not core's numeric ones", async () => {
  const snapshot = (await runScenario()).captureWorldState({ meta: META });
  assert.deepEqual(
    snapshot.actors.map((actor) => actor.id).sort(),
    ["flame", "walker"],
  );
});

test("a run in which no actor moved is visibly distinct from one in which they did", async () => {
  const stuck = await runScenario({ stamina: 0 });
  const moving = await runScenario();
  const stuckPos = stuck.captureWorldState({ meta: META }).actors.find((actor) => actor.id === "walker").position;
  const movingPos = moving.captureWorldState({ meta: META }).actors.find((actor) => actor.id === "walker").position;
  assert.deepEqual(stuckPos, { x: 0, y: 0 });
  assert.notDeepEqual(movingPos, stuckPos);
});

test("hazard actors remain in the actor list with live vitals", async () => {
  const runtime = await runScenario();
  const snapshot = runtime.captureWorldState({ meta: META });
  const flame = snapshot.actors.find((actor) => actor.id === "flame");
  assert.equal(flame.position.x, 3);
  assert.equal(flame.vitals.durability.current, 5);
  assert.ok(Number.isFinite(flame.vitals.mana.current));
});

test("an Annotator that never observed the run refuses to sign a snapshot", async () => {
  const runtime = await runScenario({ ticks: 0 });
  assert.ok(runtime.captureWorldState({ meta: META }), "a zero-tick run may still be snapshotted");
});

// ## TODO: Test Permutations
// Keep every assertion on the SNAPSHOT vs REGISTRY, never on the action ledger.
// - actor counts 1 / 2 / 4 / 11, and tick counts 1 / 2 / 10 / 100
// - a snapshot taken twice on the same finished run must be byte-identical
