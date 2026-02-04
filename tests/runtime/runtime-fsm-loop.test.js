const test = require("node:test");
const assert = require("node:assert/strict");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const runtimeModule = moduleUrl("packages/runtime/src/runner/runtime.js");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js");

const script = `
import assert from "node:assert/strict";
import { createRuntime } from ${JSON.stringify(runtimeModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

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
`;

test("fsm runtime advances tick phases and applies persona actions", () => {
  runEsm(script);
});
