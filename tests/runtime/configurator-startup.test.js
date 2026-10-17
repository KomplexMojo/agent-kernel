/**
 * Leftover configurator-startup fed layout.tiles/kinds/hazards into runtime.init.
 * Rebuild through Configurator terrain + roster; assert registry/terrain, not
 * leftover world getters or layout.hazards.
 */
const assert = require("node:assert/strict");

test("runtime applies configurator sim config and initial state artifacts", async () => {
  const [{ createRuntime }, { createCore }, { boxedTerrain, buildUnifiedArtifacts }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
    import("../fixtures/personas/unified-actor-runtime.mjs"),
  ]);

  // Fixture glyph layout "#ES##" / "#...#" × 3 / "#####": spawn (2,0), exit (1,0).
  const width = 5;
  const height = 5;
  const terrain = boxedTerrain(width, height);
  terrain[0 * width + 1] = "exit";
  terrain[0 * width + 2] = "spawn";
  for (let x = 1; x <= 3; x += 1) {
    for (let y = 1; y <= 3; y += 1) terrain[y * width + x] = "floor";
  }
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "run_configurator_hazard",
    clock: "2026-09-06T18:16:36.376Z",
    actors: [{
      id: "actor_mvp",
      category: "delver",
      position: { x: 2, y: 1 },
      motivations: ["exploring"],
      vitals: {
        health: { current: 11, max: 12, regen: 0 },
        mana: { current: 0, max: 2, regen: 0 },
      },
      affinities: [
        { kind: "fire", expression: "push", stacks: 2 },
        { kind: "growth", expression: "pull", stacks: 1 },
      ],
    }],
  });

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });

  const snapshot = runtime.getActorSnapshot();
  assert.equal(snapshot.dimensions.width, 5);
  assert.equal(snapshot.dimensions.height, 5);
  assert.equal(snapshot.terrain[0 * width + 2], "spawn");
  assert.equal(snapshot.terrain[0 * width + 1], "exit");
  assert.equal(snapshot.terrain[1 * width + 2], "floor");
  assert.equal(snapshot.terrain[1 * width + 1], "floor");

  const actor = snapshot.actors.find((entry) => entry.id === "actor_mvp");
  assert.ok(actor, "actor_mvp must load into the unified registry");
  assert.deepEqual(actor.position, { x: 2, y: 1 });
  assert.equal(actor.vitals.health.current, 11);
  assert.equal(actor.vitals.health.max, 12);
  assert.equal(actor.vitals.mana.max, 2);
  assert.equal(
    snapshot.actors.some((entry) => entry.position.x === 3 && entry.position.y === 3),
    false,
    "leftover layout.hazards must not become an occupant at 3,3 in this oracle",
  );
  assert.equal(Object.hasOwn(simConfig.layout.data, "tiles"), false);
  assert.equal(Object.hasOwn(simConfig.layout.data, "hazards"), false);
  assert.equal(Object.hasOwn(simConfig.layout.data, "kinds"), false);
});

// ## TODO: Test Permutations
// - leftover tiles/kinds/hazards fixtures still fail category storage at runtime.init
// - a hazard actor at 3,3 appears in the registry when authored as a unified actor
