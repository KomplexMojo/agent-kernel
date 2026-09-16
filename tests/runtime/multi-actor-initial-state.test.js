const assert = require("node:assert/strict");

async function artifacts(actors, { movementStamina } = {}) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const width = 9;
  const height = 9;
  const terrain = boxedTerrain(width, height);
  terrain[width + 1] = "spawn";
  terrain[(height - 2) * width + (width - 2)] = "exit";
  return buildUnifiedArtifacts({
    width,
    height,
    terrain,
    runId: "run_mvp_grid",
    clock: "2026-03-28T00:00:00.000Z",
    actors,
    movementStamina,
  });
}

function actor(id, position, health, category = "delver") {
  return {
    id,
    category,
    position,
    motivations: [],
    vitals: { health: { current: health, max: health, regen: 0 } },
  };
}

async function startRuntime(actors, movementStamina) {
  const { simConfig, initialState } = await artifacts(actors, { movementStamina });
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });
  return { runtime, simConfig };
}

test("runtime loads multi-actor initial state into core", async () => {
  const actors = [
    actor("actor_alpha", { x: 2, y: 1 }, 10),
    actor("actor_beta", { x: 3, y: 1 }, 20, "warden"),
    actor("actor_gamma", { x: 1, y: 2 }, 30, "warden"),
  ];
  const { runtime, simConfig } = await startRuntime(actors, {
    actor_alpha: 1,
    actor_beta: 2,
    actor_gamma: 1,
  });
  const snapshot = runtime.getActorSnapshot();
  assert.equal(snapshot.actors.length, 3);
  assert.deepEqual(
    snapshot.actors.find((entry) => entry.id === "actor_alpha").position,
    { x: 2, y: 1 },
  );
  assert.deepEqual(
    snapshot.actors.find((entry) => entry.id === "actor_beta").position,
    { x: 3, y: 1 },
  );
  assert.deepEqual(
    snapshot.actors.find((entry) => entry.id === "actor_gamma").position,
    { x: 1, y: 2 },
  );
  assert.equal(snapshot.actors.find((entry) => entry.id === "actor_alpha").vitals.health.current, 10);
  assert.equal(snapshot.actors.find((entry) => entry.id === "actor_beta").vitals.health.current, 20);
  assert.equal(snapshot.actors.find((entry) => entry.id === "actor_gamma").vitals.health.current, 30);
  assert.equal(simConfig.actionCosts.movementStamina.actor_alpha, 1);
  assert.equal(simConfig.actionCosts.movementStamina.actor_beta, 2);
  assert.equal(simConfig.actionCosts.movementStamina.actor_gamma, 1);
});

test("runtime init rejects initial state with duplicate actor ids", async () => {
  await assert.rejects(
    startRuntime([
      actor("actor_alpha", { x: 2, y: 1 }, 10),
      actor("actor_alpha", { x: 3, y: 1 }, 20, "warden"),
    ]),
    /duplicate actor id/,
  );
});
