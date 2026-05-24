const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

test("runtime applies configurator sim config and initial state artifacts", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const simConfig = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json"), "utf8"),
  );
  const initialState = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json"), "utf8"),
  );
  initialState.actors = initialState.actors.filter((actor) => actor.id === "actor_mvp");
  initialState.actors[0].position = { x: 1, y: 1 };

  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState });

  assert.equal(core.getMapWidth(), 5);
  assert.equal(core.getMapHeight(), 5);
  assert.equal(core.getActorX(), 1);
  assert.equal(core.getActorY(), 1);
  assert.equal(core.getActorVitalCurrent(0), 11);
  assert.equal(core.getActorVitalMax(0), 12);
  assert.equal(core.getActorVitalMax(1), 2);
  assert.equal(String.fromCharCode(core.renderBaseCellChar(2, 1)), "S");
  assert.equal(String.fromCharCode(core.renderBaseCellChar(1, 3)), "E");
  assert.equal(core.getTileActorKind(2, 2), 0);
});
