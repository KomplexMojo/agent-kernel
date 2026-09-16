/**
 * Resource actors carry unclaimed holdings in the unified snapshot. There is no
 * separate resources collection; a claimed holding stays on the source with
 * claimedBy rather than vanishing from a parallel cell list.
 */
"use strict";

const assert = require("node:assert/strict");

const CLOCK = "2026-08-14T00:00:00.000Z";
const META = { id: "ws", runId: "ws", createdAt: CLOCK, producedBy: "annotator" };

async function artifacts({ includeCache = true } = {}) {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const layout = {
    width: 3,
    height: 1,
    terrain: ["floor", "floor", "exit"],
    exitApproach: { x: 1, y: 0 },
  };
  const actors = [
    {
      id: "walker",
      category: "delver",
      position: { x: 0, y: 0 },
      motivations: ["exploring"],
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    },
  ];
  if (includeCache) {
    actors.push({
      id: "cache",
      category: "resource",
      position: { x: 1, y: 0 },
      vitals: { durability: { current: 0, max: 3, regen: 0 } },
      affinities: [{ kind: "fire", expression: "emit", stacks: 8 }],
      activeAffinityKey: null,
      holdings: [{
        id: "vital:health",
        kind: "vital",
        permanenceMode: "consumable",
        claimedBy: null,
        vitals: [{ key: "health", delta: 5, regen: 2 }],
      }],
    });
  }
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "ws_sim", runId: "ws", createdAt: CLOCK },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { walker: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "ws", runId: "ws", createdAt: CLOCK },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 3, height: 1 },
    terrain: layout.terrain,
    actors,
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
  return runtime;
}

test("the snapshot reports a resource actor with its authored holdings", async () => {
  const snapshot = (await runScenario()).captureWorldState({ meta: META });
  assert.equal(Object.hasOwn(snapshot, "resources"), false);
  const cache = snapshot.actors.find((actor) => actor.id === "cache");
  assert.deepEqual(cache.position, { x: 1, y: 0 });
  assert.equal(cache.lifecycle, "defeated");
  const holding = cache.holdings.find((entry) => entry.kind === "vital");
  assert.equal(holding.claimedBy, null);
  assert.equal(holding.permanenceMode, "consumable");
  assert.deepEqual(holding.vitals, [{ key: "health", delta: 5, regen: 2 }]);
});

test("affinity holdings remain on the defeated resource actor", async () => {
  const cache = (await runScenario()).captureWorldState({ meta: META })
    .actors.find((actor) => actor.id === "cache");
  const affinity = cache.holdings.find((entry) => entry.kind === "affinity");
  assert.equal(affinity.affinity, "fire");
  assert.equal(affinity.expression, "emit");
  assert.equal(affinity.claimedBy, null);
});

test("a world with no resource actors has no resources collection to empty", async () => {
  const snapshot = (await runScenario({ includeCache: false })).captureWorldState({ meta: META });
  assert.equal(Object.hasOwn(snapshot, "resources"), false);
  assert.equal(snapshot.schemaVersion, 2);
  assert.ok(snapshot.actors.every((actor) => actor.id !== "cache"));
});

// ## TODO: Test Permutations
test.skip("claimed holdings keep claimedBy across later snapshots", async () => {});

test("resource ordering is stable across snapshots of the same world", async () => {
  const runtime = await runScenario();
  const first = runtime.captureWorldState({ meta: META }).actors.map((actor) => actor.id);
  const second = runtime.captureWorldState({ meta: { ...META, id: "ws2" } }).actors.map((actor) => actor.id);
  assert.deepEqual(first, second);
});
