const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

test("runtime loads multi-actor initial state into core", async () => {
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );
  const { createCore } = await import(
    "../../packages/core-ts/src/index.ts"
  );

  const core = createCore();

  const simConfig = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"), "utf8"),
  );
  const initialState = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-mvp-multi.json"), "utf8"),
  );

  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });

  assert.equal(core.getMotivatedActorCount(), 3);
  assert.deepEqual(
    { x: core.getMotivatedActorXByIndex(0), y: core.getMotivatedActorYByIndex(0) },
    { x: 2, y: 1 },
  );
  assert.deepEqual(
    { x: core.getMotivatedActorXByIndex(1), y: core.getMotivatedActorYByIndex(1) },
    { x: 3, y: 1 },
  );
  assert.deepEqual(
    { x: core.getMotivatedActorXByIndex(2), y: core.getMotivatedActorYByIndex(2) },
    { x: 1, y: 2 },
  );
  assert.equal(core.getMotivatedActorVitalCurrentByIndex(0, 0), 10);
  assert.equal(core.getMotivatedActorVitalCurrentByIndex(1, 0), 20);
  assert.equal(core.getMotivatedActorVitalCurrentByIndex(2, 0), 30);
  assert.equal(core.getMotivatedActorMovementCostByIndex(0), 1);
  assert.equal(core.getMotivatedActorActionCostManaByIndex(0), 0);
  assert.equal(core.getMotivatedActorActionCostStaminaByIndex(0), 0);
  assert.equal(core.getMotivatedActorMovementCostByIndex(1), 2);
  assert.equal(core.getMotivatedActorActionCostManaByIndex(1), 1);
  assert.equal(core.getMotivatedActorActionCostStaminaByIndex(1), 0);
  assert.equal(core.getMotivatedActorMovementCostByIndex(2), 1);
  assert.equal(core.getMotivatedActorActionCostManaByIndex(2), 0);
  assert.equal(core.getMotivatedActorActionCostStaminaByIndex(2), 2);
  assert.equal(core.getActorX(), 2);
  assert.equal(core.getActorY(), 1);
});

test("runtime init rejects initial state with duplicate actor ids", async () => {
  const { createRuntime } = await import(
    "../../packages/runtime/src/runner/runtime.js"
  );
  const { createCore } = await import(
    "../../packages/core-ts/src/index.ts"
  );

  const core = createCore();

  const simConfig = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"), "utf8"),
  );
  const initialState = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/invalid/initial-state-artifact-v1-duplicate-actor-id.json"), "utf8"),
  );

  const runtime = createRuntime({ core, adapters: {} });
  await assert.rejects(
    runtime.init({ seed: 0, simConfig, initialState }),
    /duplicate_actor_id/,
  );
});
