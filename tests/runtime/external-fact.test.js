const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const RUNTIME_MODULE = moduleUrl("packages/runtime/src/runner/runtime.js");

test("need_external_fact effects enforce sourceRef policy", () => {
  const script = `
import assert from "node:assert/strict";
import { createRuntime } from ${JSON.stringify(RUNTIME_MODULE)};

let effectCount = 2;
const effectKinds = [900, 901];
const effectValues = [1, 0];

const core = {
  init() {},
  step() {},
  getCounter() { return 0; },
  getEffectCount() { return effectCount; },
  getEffectKind(index) { return effectKinds[index]; },
  getEffectValue(index) { return effectValues[index]; },
  clearEffects() { effectCount = 0; },
};

const effectFactory = ({ tick, kind }) => {
  const hasSource = kind === 900;
  return {
    schema: "agent-kernel/Effect",
    schemaVersion: 1,
    tick,
    fulfillment: "deterministic",
    kind: "need_external_fact",
    data: {
      query: "fixture",
    },
    sourceRef: hasSource
      ? { id: "fixture_fact", schema: "agent-kernel/IntentEnvelope", schemaVersion: 1 }
      : undefined,
  };
};

const runtime = createRuntime({ core, adapters: {}, effectFactory });
await runtime.init({ seed: 0, simConfig: null });
const frames = runtime.getTickFrames();
assert.equal(frames.length, 1);
const fulfilled = frames[0].fulfilledEffects;
assert.equal(fulfilled.length, 2);
assert.equal(fulfilled[0].status, "fulfilled");
assert.ok(fulfilled[0].result);
assert.equal(fulfilled[1].status, "deferred");
assert.equal(fulfilled[1].reason, "missing_source_ref");
`;
  runEsm(script);
});
