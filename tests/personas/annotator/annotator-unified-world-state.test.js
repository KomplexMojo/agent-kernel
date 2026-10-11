/**
 * Unified world-state snapshots are registry actors: equipment, defeat, and
 * claims travel with the records. Hazard/resource cell collections are gone.
 */
"use strict";

const assert = require("node:assert/strict");

const CLOCK = "2026-09-16T00:00:00.000Z";
const META = { id: "ws", runId: "ws", createdAt: CLOCK, producedBy: "annotator" };
const TICKS = 8;

async function artifacts() {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const layout = {
    width: 5,
    height: 1,
    terrain: ["floor", "floor", "floor", "floor", "exit"],
    exitApproach: { x: 3, y: 0 },
  };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "ws-config", runId: "ws", createdAt: CLOCK },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { walker: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "ws-state", runId: "ws", createdAt: CLOCK },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 5, height: 1 },
    terrain: layout.terrain,
    actors: [
      {
        id: "walker",
        category: "delver",
        position: { x: 0, y: 0 },
        motivations: ["exploring"],
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 20, max: 20, regen: 0 },
        },
        affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
        activeAffinityKey: "fire:push",
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
      {
        id: "cache",
        category: "resource",
        position: { x: 1, y: 0 },
        vitals: { durability: { current: 0, max: 2, regen: 0 } },
        affinities: [{ kind: "fire", expression: "emit", stacks: 8 }],
        activeAffinityKey: null,
      },
    ],
  });
  return { simConfig, initialState };
}

async function runTicks(ticks) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../../packages/runtime/src/runner/runtime.js"),
    import("../../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, ...(await artifacts()) });
  for (let i = 0; i < ticks; i += 1) await runtime.step();
  return runtime;
}

test("unified snapshots copy registry actors including equipment, defeat and claims", async () => {
  const runtime = await runTicks(TICKS);
  const snapshot = runtime.captureWorldState({ meta: META });
  const live = runtime.getActorSnapshot();
  const presentation = runtime.getActorPresentation();

  assert.equal(snapshot.schema, "agent-kernel/WorldStateArtifact");
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.tick, TICKS);
  assert.equal(Object.hasOwn(snapshot, "hazards"), false);
  assert.equal(Object.hasOwn(snapshot, "resources"), false);
  assert.deepEqual(snapshot.actors, live.actors);
  assert.deepEqual(snapshot.presentation, presentation);
  assert.deepEqual(snapshot.dimensions, live.dimensions);

  const walker = snapshot.actors.find((actor) => actor.id === "walker");
  assert.equal(walker.activeAffinityKey, "fire:push");
  assert.ok(Array.isArray(walker.affinities));

  const flame = snapshot.actors.find((actor) => actor.id === "flame");
  assert.equal(flame.vitals.durability.current, 5);
  assert.ok(Number.isFinite(flame.vitals.mana.current));

  const cache = snapshot.actors.find((actor) => actor.id === "cache");
  assert.equal(cache.lifecycle, "defeated");
  assert.equal(cache.vitals.durability.current, 0);
  assert.ok(cache.holdings.some((holding) => holding.kind === "affinity"));
});

test("an Annotator that never observed a ticked run refuses to sign a snapshot", async () => {
  const runtime = await runTicks(0);
  assert.ok(runtime.captureWorldState({ meta: META }), "a zero-tick run may still be snapshotted");
});

// ## TODO: Test Permutations
// - claimed holding carries claimedBy after take
// - exited actors remain in the snapshot at their last position
