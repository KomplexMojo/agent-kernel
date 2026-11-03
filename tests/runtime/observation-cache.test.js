/**
 * Runtime caches the unscoped observation between registry mutations so play-session
 * view()/fog helpers do not rebuild affinity fields on every readVisible/readFieldCells
 * call (vast-level movement lag).
 */
const assert = require("node:assert/strict");
const { createRuntime } = require("../../packages/runtime/src/runner/runtime.js");
const { createCore } = require("../../packages/core-ts/src/index.ts");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const HALL = ["######", "#S..E#", "######"];
const level = () => buildUnifiedLevel({
  id: "obs-cache",
  tiles: HALL,
  actors: [{
    category: "delver",
    id: "hero",
    position: { x: 1, y: 1 },
    vitals: viableVitals({ mana: 40 }),
    motivations: ["user_controlled"],
    affinities: [{ kind: "fire", expression: "emit", stacks: 2, intensity: 1 }],
    activeAffinityKey: "fire:emit",
  }],
});

test("consecutive observation reads share one object until an act mutates the registry", async () => {
  const { simConfig, initialState } = level();
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });

  const first = runtime.readObservation();
  const snap = runtime.getActorSnapshot();
  assert.ok(first);
  assert.ok(snap);
  assert.equal(runtime.readObservation(), first, "readObservation must return the cached observation");
  assert.equal(runtime.getActorSnapshot(), snap, "getActorSnapshot must return the cached snapshot");
  runtime.readVisibleCells("hero");
  runtime.readDarkCells("hero");
  runtime.readRevealLevels("hero");
  runtime.readFieldCells();
  assert.equal(runtime.readObservation(), first, "fog/field readers must reuse the cached observation");
  assert.equal(runtime.getActorSnapshot(), snap, "fog/field readers must not bust the snapshot cache");

  await runtime.step({ actorCommands: { hero: { kind: "move", params: { direction: "east" } } } });
  const after = runtime.readObservation();
  assert.notEqual(after, first, "an applied tick must invalidate the observation cache");
  assert.notEqual(runtime.getActorSnapshot(), snap, "an applied tick must invalidate the snapshot cache");
  assert.equal(runtime.readObservation(), after);
});

// ## TODO: Test Permutations
// - cache survives readObservation after readFieldCells on a multi-actor board
// - init() clears a stale cache from a previous run on the same runtime instance
