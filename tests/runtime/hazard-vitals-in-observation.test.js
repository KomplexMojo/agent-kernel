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

test("runtime observation enriches static hazards with vitals from sim config layout", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const observations = [];
  const runtime = createRuntime({
    core: createCore(),
    adapters: {},
    personas: { actor: captureObservationPersona(observations) },
  });
  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "sim_hazard_vitals", runId: "run_hazard_vitals", createdAt: "2026-06-11T00:00:00.000Z", producedBy: "test" },
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 5,
        tiles: [".....", ".....", ".....", ".....", "....."],
        hazards: [
          {
            x: 1,
            y: 1,
            blocking: false,
            affinity: { kind: "fire", expression: "emit", stacks: 2 },
            vitals: {
              mana: { current: 12, max: 12, regen: 4 },
              durability: { current: 10, max: 10, regen: 0 },
            },
          },
          {
            x: 3,
            y: 2,
            blocking: false,
            affinity: { kind: "water", expression: "emit", stacks: 1 },
            vitals: {
              mana: { current: 9, max: 9, regen: 3 },
              durability: { current: 5, max: 5, regen: 0 },
            },
          },
        ],
      },
    },
  };

  await runtime.init({ seed: 0, simConfig });
  await runtime.step();

  assert.ok(observations.length > 0);
  const observation = observations[0];
  assert.ok(Array.isArray(observation.hazards));
  const hazardAtOneOne = observation.hazards.find((hazard) => hazard.position?.x === 1 && hazard.position?.y === 1);
  const hazardAtThreeTwo = observation.hazards.find((hazard) => hazard.position?.x === 3 && hazard.position?.y === 2);

  assert.deepEqual(hazardAtOneOne.vitals, simConfig.layout.data.hazards[0].vitals);
  assert.deepEqual(hazardAtThreeTwo.vitals, simConfig.layout.data.hazards[1].vitals);
});
