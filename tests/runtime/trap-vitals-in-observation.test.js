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

test("runtime observation enriches static traps with vitals from sim config layout", async () => {
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
    meta: { id: "sim_trap_vitals", runId: "run_trap_vitals", createdAt: "2026-06-11T00:00:00.000Z", producedBy: "test" },
    layout: {
      kind: "grid",
      data: {
        width: 5,
        height: 5,
        tiles: [".....", ".....", ".....", ".....", "....."],
        traps: [
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
  assert.ok(Array.isArray(observation.traps));
  const trapAtOneOne = observation.traps.find((trap) => trap.position?.x === 1 && trap.position?.y === 1);
  const trapAtThreeTwo = observation.traps.find((trap) => trap.position?.x === 3 && trap.position?.y === 2);

  assert.deepEqual(trapAtOneOne.vitals, simConfig.layout.data.traps[0].vitals);
  assert.deepEqual(trapAtThreeTwo.vitals, simConfig.layout.data.traps[1].vitals);
});
