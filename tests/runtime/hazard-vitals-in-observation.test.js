const assert = require("node:assert/strict");

function captureObservationPersona(captured) {
  return {
    subscribePhases: ["observe"],
    view() {
      return { state: "idle", context: {} };
    },
    advance({ payload }) {
      if (payload?.observation) {
        captured.push(payload.observation);
      }
      return { state: "idle", context: {}, actions: [], effects: [], telemetry: null };
    },
  };
}

test("runtime observation carries hazard actor vitals without a hazards collection", async () => {
  const [{ createRuntime }, { createCore }, { createConfiguratorPersona }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/runtime/src/personas/configurator/controller.js"),
  ]);
  const observations = [];
  const configurator = createConfiguratorPersona({ clock: () => "2026-09-16T00:00:00.000Z" });
  const terrain = Array(25).fill("floor");
  const actors = [
    {
      id: "observer",
      category: "delver",
      position: { x: 2, y: 2 },
      motivations: ["stationary"],
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    },
    {
      id: "flame",
      category: "hazard",
      position: { x: 1, y: 1 },
      affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
      activeAffinityKey: "fire:emit",
      vitals: {
        mana: { current: 12, max: 12, regen: 4 },
        durability: { current: 10, max: 10, regen: 0 },
      },
    },
    {
      id: "tide",
      category: "hazard",
      // Adjacent to both flame (the primary, id-sorted first) and observer: levels are unlit.
      position: { x: 2, y: 1 },
      affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
      activeAffinityKey: "water:emit",
      vitals: {
        mana: { current: 9, max: 9, regen: 3 },
        durability: { current: 5, max: 5, regen: 0 },
      },
    },
  ];
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "sim_hazard_vitals", runId: "run_hazard_vitals", createdAt: "2026-09-16T00:00:00.000Z", producedBy: "test" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width: 5, height: 5, terrain },
    movementStamina: { observer: 1 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "state_hazard_vitals", runId: "run_hazard_vitals", createdAt: "2026-09-16T00:00:00.000Z", producedBy: "test" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 5, height: 5 },
    terrain,
    actors,
  });
  const runtime = createRuntime({
    core: createCore(),
    adapters: {},
    personas: { actor: captureObservationPersona(observations) },
  });

  await runtime.init({ seed: 0, simConfig, initialState });
  await runtime.step();

  assert.ok(observations.length > 0);
  const observation = observations[0];
  assert.equal(Object.hasOwn(observation, "hazards"), false);
  const flame = observation.actors.find((actor) => actor.id === "flame");
  const tide = observation.actors.find((actor) => actor.id === "tide");
  assert.deepEqual(flame.vitals.mana, { current: 12, max: 12, regen: 4 });
  assert.deepEqual(flame.vitals.durability, { current: 10, max: 10, regen: 0 });
  assert.deepEqual(tide.vitals.mana, { current: 9, max: 9, regen: 3 });
  assert.deepEqual(tide.vitals.durability, { current: 5, max: 5, regen: 0 });
});
