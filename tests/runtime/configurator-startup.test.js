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
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-hazard.json"), "utf8"),
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
  // Updated 2026-07-10: hazard coordinates adjudicated as room-relative (M3); formerly pinned grid-absolute semantics.
  // The regenerated sim-config fixture maps the authored hazard (2,2) into room R1 at (1,1) -> (3,3),
  // which shifts spawn to (2,2) and exit to (1,1) (hazard tiles are excluded from spawn/exit candidates).
  assert.equal(String.fromCharCode(core.renderBaseCellChar(2, 2)), "S");
  assert.equal(String.fromCharCode(core.renderBaseCellChar(1, 1)), "E");
  assert.equal(core.getTileActorKind(3, 3), 0);
});
