/**
 * Layout category storage belongs to Configurator authoring, not the production
 * loader. initializeCoreFromArtifacts rejects tiles/hazards/resources on layout.
 */
const assert = require("node:assert/strict");

test("production loader rejects leftover layout hazard storage", async () => {
  const { initializeCoreFromArtifacts } = await import(
    "../../packages/runtime/src/runner/core-setup.mjs"
  );
  assert.throws(() => initializeCoreFromArtifacts({
    simConfig: {
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
      meta: { id: "cfg" },
      layout: { kind: "grid", data: { width: 1, height: 1, terrain: ["floor"], hazards: [] } },
    },
    initialState: {
      schema: "agent-kernel/InitialStateArtifact",
      schemaVersion: 1,
      meta: { id: "st" },
      simConfigRef: { id: "cfg", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
      actors: [],
      presentation: {},
    },
  }), /category storage/);
});

test("production loader loads hazard actors from initial state", async () => {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const { initializeCoreFromArtifacts } = await import(
    "../../packages/runtime/src/runner/core-setup.mjs"
  );
  const configurator = createConfiguratorPersona({ clock: () => "fixed" });
  const layout = { width: 2, height: 1, terrain: ["floor", "floor"] };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "cfg", runId: "r", createdAt: "fixed" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: {},
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "st", runId: "r", createdAt: "fixed" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 2, height: 1 },
    terrain: layout.terrain,
    actors: [{
      id: "flame",
      category: "hazard",
      position: { x: 0, y: 0 },
      vitals: { durability: { current: 4, max: 4, regen: 0 }, mana: { current: 3, max: 3, regen: 0 } },
      affinities: [{ kind: "earth", expression: "emit", stacks: 3 }],
      activeAffinityKey: "earth:emit",
    }],
  });
  const { registry, presentation } = initializeCoreFromArtifacts({ simConfig, initialState });
  const flame = registry.getActor("flame");
  assert.equal(presentation.flame.category, "hazard");
  assert.deepEqual(flame.affinities, [{ kind: "earth", expression: "emit", stacks: 3 }]);
  assert.equal(flame.vitals.mana.current, 3);
  assert.equal(flame.capabilities.canMove, false);
});
