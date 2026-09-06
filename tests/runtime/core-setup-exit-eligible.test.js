const assert = require("node:assert/strict");

let setupModulePromise;
let coreModulePromise;

function loadSetupModule() {
  setupModulePromise ??= import("../../packages/runtime/src/runner/core-setup.mjs");
  return setupModulePromise;
}

function loadCoreModule() {
  coreModulePromise ??= import("../../packages/core-ts/src/index.ts");
  return coreModulePromise;
}

function createPortalSimConfig() {
  return {
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 5,
        tiles: [
          "#####",
          "S...#",
          "#...#",
          "#...E",
          "#####",
        ],
        spawn: { x: 0, y: 1 },
        exit: { x: 4, y: 3 },
        spawnApproach: { x: 1, y: 1 },
        exitApproach: { x: 3, y: 3 },
      },
    },
  };
}

test("applySimConfigToCore wires spawn/exit approaches onto core", async () => {
  const { createCore } = await loadCoreModule();
  const { applySimConfigToCore } = await loadSetupModule();
  const core = createCore();
  const result = applySimConfigToCore(core, createPortalSimConfig());
  assert.equal(result.ok, true);
  assert.deepEqual(result.spawnApproach, { x: 1, y: 1 });
  assert.deepEqual(result.exitApproach, { x: 3, y: 3 });
  assert.equal(core.isWalkablePosition(0, 1), false);
  assert.equal(core.isWalkablePosition(4, 3), false);
  assert.equal(core.isWalkablePosition(1, 1), true);
  assert.equal(core.isWalkablePosition(3, 3), true);
});

test("applyInitialStateToCore sets exitEligible from actor role", async () => {
  const { createCore } = await loadCoreModule();
  const { applySimConfigToCore, applyInitialStateToCore } = await loadSetupModule();
  const core = createCore();
  const layoutResult = applySimConfigToCore(core, createPortalSimConfig());
  assert.equal(layoutResult.ok, true);

  const actorResult = applyInitialStateToCore(
    core,
    {
      actors: [
        { id: "delver_a", role: "delver", position: { x: 1, y: 1 } },
        { id: "warden_b", role: "warden", position: { x: 3, y: 3 } },
      ],
    },
    { spawn: layoutResult.spawn, spawnApproach: layoutResult.spawnApproach },
  );
  assert.equal(actorResult.ok, true, JSON.stringify(actorResult));
  assert.equal(core.isMotivatedActorExitEligible(0), true);
  assert.equal(core.isMotivatedActorExitEligible(1), false);
});
