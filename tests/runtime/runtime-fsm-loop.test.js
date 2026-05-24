const assert = require("node:assert/strict");

let runtimeDepsPromise;

async function loadRuntimeDeps() {
  runtimeDepsPromise ??= Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]).then(([runtime, tick]) => ({
    createRuntime: runtime.createRuntime,
    TickPhases: tick.TickPhases,
  }));
  return runtimeDepsPromise;
}

test("fsm runtime advances tick phases and applies persona actions", async () => {
  const { createRuntime, TickPhases } = await loadRuntimeDeps();
  const applied = [];
  const effects = [];
  const core = {
    init() {},
    applyAction(kind, value) {
      applied.push({ kind, value });
      effects.push({ kind: 1, value });
    },
    getCounter() { return applied.length; },
    getEffectCount() { return effects.length; },
    getEffectKind(index) { return effects[index]?.kind ?? 0; },
    getEffectValue(index) { return effects[index]?.value ?? 0; },
    clearEffects() { effects.length = 0; },
  };

  const stubActor = {
    subscribePhases: [TickPhases.OBSERVE, TickPhases.DECIDE],
    state: "idle",
    view() {
      return { state: this.state, context: { lastEvent: null } };
    },
    advance({ event, tick }) {
      if (event === "observe") {
        this.state = "observing";
        return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
      }
      if (event === "decide") {
        this.state = "deciding";
        return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
      }
      if (event === "propose") {
        this.state = "proposing";
        return {
          state: this.state,
          context: { lastEvent: event },
          actions: [
            { actorId: "actor_1", tick, kind: "wait", params: {} },
            { actorId: "actor_1", tick, kind: "emit_log", params: { severity: "warn" } },
          ],
          effects: [],
          telemetry: null,
        };
      }
      if (event === "cooldown") {
        this.state = "cooldown";
        return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
      }
      return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
    },
  };

  const runtime = createRuntime({ core, adapters: { logger: { log() {}, warn() {}, error() {} } }, personas: { actor: stubActor } });
  await runtime.init({ seed: 0 });
  await runtime.step();
  await runtime.step();

  const frames = runtime.getTickFrames();
  assert.equal(frames.length, 11);
  assert.deepEqual(frames.map((frame) => frame.phaseDetail), [
    "init",
    "observe",
    "decide",
    "apply",
    "emit",
    "summarize",
    "observe",
    "decide",
    "apply",
    "emit",
    "summarize",
  ]);

  const applyFrames = frames.filter((frame) => frame.phaseDetail === "apply");
  assert.equal(applyFrames.length, 2);
  assert.equal(applyFrames[0].acceptedActions.length, 2);
  assert.equal(applyFrames[1].acceptedActions.length, 2);
  assert.equal(applied.length, 4);
  assert.deepEqual(applied.map((entry) => entry.kind), [1, 2, 1, 2]);
  assert.deepEqual(applied.map((entry) => entry.value), [1, 2, 1, 2]);

  const emitFrame = frames.find((frame) => frame.phaseDetail === "emit");
  assert.ok(Array.isArray(emitFrame.emittedEffects));
  assert.ok(Array.isArray(emitFrame.fulfilledEffects));
});

test("fsm runtime infers diagonal move direction from coordinates when direction is omitted", async () => {
  const { createRuntime, TickPhases } = await loadRuntimeDeps();
  const applied = [];
  const effects = [];
  const core = {
    init() {},
    setMoveAction(actorId, fromX, fromY, toX, toY, direction, tick) {
      applied.push({ actorId, fromX, fromY, toX, toY, direction, tick });
    },
    applyAction(kind, value) {
      effects.push({ kind, value });
    },
    getCurrentTick() { return 0; },
    getEffectCount() { return effects.length; },
    getEffectKind(index) { return effects[index]?.kind ?? 0; },
    getEffectValue(index) { return effects[index]?.value ?? 0; },
    clearEffects() { effects.length = 0; },
  };

  const stubActor = {
    subscribePhases: [TickPhases.OBSERVE, TickPhases.DECIDE],
    state: "idle",
    view() {
      return { state: this.state, context: { lastEvent: null } };
    },
    advance({ event, tick }) {
      if (event === "observe") {
        this.state = "observing";
        return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
      }
      if (event === "decide") {
        this.state = "deciding";
        return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
      }
      if (event === "propose") {
        this.state = "proposing";
        return {
          state: this.state,
          context: { lastEvent: event },
          actions: [
            {
              actorId: "actor_1",
              tick,
              kind: "move",
              params: {
                from: { x: 1, y: 1 },
                to: { x: 2, y: 0 },
              },
            },
          ],
          effects: [],
          telemetry: null,
        };
      }
      if (event === "cooldown") {
        this.state = "cooldown";
        return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
      }
      return { state: this.state, context: { lastEvent: event }, actions: [], effects: [], telemetry: null };
    },
  };

  const runtime = createRuntime({ core, adapters: {}, personas: { actor: stubActor } });
  await runtime.init({ seed: 0 });
  await runtime.step();

  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], {
    actorId: 1,
    fromX: 1,
    fromY: 1,
    toX: 2,
    toY: 0,
    direction: 1,
    tick: 1,
  });

  const applyFrame = runtime.getTickFrames().find((frame) => frame.phaseDetail === "apply");
  assert.equal(applyFrame.acceptedActions.length, 1);
  assert.equal(applyFrame.acceptedActions[0].params.direction, undefined);
  assert.equal(applyFrame.preCoreRejections, undefined);
});
