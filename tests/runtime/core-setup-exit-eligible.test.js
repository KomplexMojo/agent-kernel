/**
 * Exit eligibility is a delver capability on the unified record, not a role
 * flag written through applyInitialStateToCore.
 */
const assert = require("node:assert/strict");

test("delver records can exit; wardens cannot", async () => {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const { initializeCoreFromArtifacts } = await import(
    "../../packages/runtime/src/runner/core-setup.mjs"
  );
  const configurator = createConfiguratorPersona({ clock: () => "fixed" });
  const layout = { width: 3, height: 1, terrain: ["floor", "floor", "exit"], exitApproach: { x: 1, y: 0 } };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "cfg", runId: "r", createdAt: "fixed" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { delver: 0, warden: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "st", runId: "r", createdAt: "fixed" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 3, height: 1 },
    terrain: layout.terrain,
    actors: [
      { id: "delver", category: "delver", position: { x: 0, y: 0 },
        vitals: { health: { current: 10, max: 10, regen: 0 } }, motivations: ["exploring"] },
      { id: "warden", category: "warden", position: { x: 1, y: 0 },
        vitals: { health: { current: 10, max: 10, regen: 0 } }, motivations: ["patrolling"] },
    ],
  });
  const { registry } = initializeCoreFromArtifacts({ simConfig, initialState });
  assert.equal(registry.getActor("delver").capabilities.canExit, true);
  assert.equal(registry.getActor("warden").capabilities.canExit, false);
});
