const assert = require("node:assert/strict");

test("runtime applies budget caps from SimConfig", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const simConfig = {
    constraints: {
      categoryCaps: {
        caps: {
          movement: 1,
        },
      },
    },
  };

  const stubActor = {
    subscribePhases: ["observe", "decide"],
    state: "idle",
    view() {
      return { state: this.state, context: { lastEvent: null } };
    },
    advance({ event, tick }) {
      if (event === "propose") {
        return {
          state: "proposing",
          context: { lastEvent: event },
          actions: [
            { actorId: "actor_1", tick, kind: "wait", params: {} },
            { actorId: "actor_1", tick, kind: "wait", params: {} },
          ],
          effects: [],
          telemetry: null,
        };
      }
      return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
    },
  };

  const runtime = createRuntime({ core: createCore(), adapters: {}, personas: { actor: stubActor } });
  await runtime.init({ seed: 0, simConfig });
  await runtime.step();

  const effectLog = runtime.getEffectLog();
  const limitEntries = effectLog.filter((entry) => entry.kind === "limit_violation");
  assert.equal(limitEntries.length, 2, "Expected two limit_violation entries (reached + violated)");
});
