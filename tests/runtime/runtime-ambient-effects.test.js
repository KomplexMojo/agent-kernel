const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const runtimeModule = moduleUrl("packages/runtime/src/runner/runtime.js");

test("runtime surfaces ambient core outcomes as structured deterministic effects", () => {
  const script = `
import assert from "node:assert/strict";
import { createRuntime } from ${JSON.stringify(runtimeModule)};

const effects = [
  {
    kind: 15,
    value: (2 << 24) | (5 << 16) | (10 << 8) | 3, // dark emit power 5
    actorId: 1,
    x: 1,
    y: 1,
    reason: 1,
    delta: -5,
  },
  {
    kind: 15,
    value: (3 << 24) | (2 << 16) | (2 << 8) | 4, // water draw power 2
    actorId: 1,
    x: 2,
    y: 1,
    reason: 1,
    delta: 2,
  },
];

const core = {
  init() {},
  applyAction() {},
  getCounter() { return 0; },
  getEffectCount() { return effects.length; },
  getEffectKind(index) { return effects[index]?.kind ?? 0; },
  getEffectValue(index) { return effects[index]?.value ?? 0; },
  getEffectActorId(index) { return effects[index]?.actorId ?? 0; },
  getEffectX(index) { return effects[index]?.x ?? 0; },
  getEffectY(index) { return effects[index]?.y ?? 0; },
  getEffectReason(index) { return effects[index]?.reason ?? 0; },
  getEffectDelta(index) { return effects[index]?.delta ?? 0; },
  clearEffects() { effects.length = 0; },
};

const runtime = createRuntime({
  core,
  adapters: { logger: { log() {}, warn() {}, error() {} } },
});

await runtime.init({ seed: 0 });
const frame = runtime.getTickFrames()[0];
const ambient = frame.emittedEffects.filter((entry) => entry.kind === "ambient_resolved");
assert.equal(ambient.length, 2);
assert.deepEqual(ambient.map((entry) => entry.data), [
  {
    actorId: 1,
    position: { x: 1, y: 1 },
    outcome: "emit",
    affinityKind: "dark",
    expression: "emit",
    power: 5,
    targetVital: "mana",
    delta: -5,
  },
  {
    actorId: 1,
    position: { x: 2, y: 1 },
    outcome: "draw",
    affinityKind: "water",
    expression: "draw",
    power: 2,
    targetVital: "mana",
    delta: 2,
  },
]);
`;
  runEsm(script);
});
