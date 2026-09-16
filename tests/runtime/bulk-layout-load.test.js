/**
 * Bulk layout load now goes through one registry snapshot, not per-cell setTileAt.
 */
const assert = require("node:assert/strict");

test("initializeCoreFromArtifacts loads a full terrain grid in one snapshot", async () => {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const { initializeCoreFromArtifacts } = await import(
    "../../packages/runtime/src/runner/core-setup.mjs"
  );
  const configurator = createConfiguratorPersona({ clock: () => "fixed" });
  const width = 8;
  const height = 4;
  const terrain = Array(width * height).fill("floor");
  for (let x = 0; x < width; x += 1) {
    terrain[x] = "wall";
    terrain[(height - 1) * width + x] = "wall";
  }
  terrain[width] = "spawn";
  terrain[width + 1] = "exit";
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "cfg", runId: "r", createdAt: "fixed" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width, height, terrain, exitApproach: { x: 1, y: 1 } },
    movementStamina: { walker: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "st", runId: "r", createdAt: "fixed" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width, height },
    terrain,
    actors: [{
      id: "walker", category: "delver", position: { x: 1, y: 1 },
      vitals: { health: { current: 10, max: 10, regen: 0 } }, motivations: ["exploring"],
    }],
  });
  const snapshot = initializeCoreFromArtifacts({ simConfig, initialState }).registry.snapshot();
  assert.equal(snapshot.terrain.length, width * height);
  assert.equal(snapshot.terrain[0], "wall");
  assert.equal(snapshot.terrain[width], "spawn");
  assert.equal(snapshot.actors[0].id, "walker");
});
