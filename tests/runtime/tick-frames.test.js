const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const RUNTIME_MODULE = moduleUrl("packages/runtime/src/runner/runtime.js");

// FAILING: tick frames do not yet carry an 'events' array for phase-level observations
// (resource_captured, trap_triggered, vital_delta, etc.).
// M4 will add events: [] to every frame produced by the runtime.
test("runtime tick frames include an events array on every phase frame", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from ${JSON.stringify(RUNTIME_MODULE)};

const buffer = await readFile(${JSON.stringify(WASM_PATH)});
const { instance } = await WebAssembly.instantiate(buffer, {
  env: {
    abort(_msg, _file, line, column) {
      throw new Error(\`WASM abort at \${line}:\${column}\`);
    },
  },
});
const exports = instance.exports;
const core = {
  init: exports.init,
  step: exports.step,
  applyAction: exports.applyAction,
  getCounter: exports.getCounter,
  setBudget: exports.setBudget,
  getBudget: exports.getBudget,
  getBudgetUsage: exports.getBudgetUsage,
  getEffectCount: exports.getEffectCount,
  getEffectKind: exports.getEffectKind,
  getEffectValue: exports.getEffectValue,
  clearEffects: exports.clearEffects,
  version: exports.version,
};

const runtime = createRuntime({ core, adapters: {} });
await runtime.init({ seed: -1, simConfig: null });
await runtime.step();
const frames = runtime.getTickFrames();

assert.ok(frames.length > 0, "must have at least one frame after init+step");
for (const frame of frames) {
  assert.ok(
    Array.isArray(frame.events),
    \`frame '\${frame.phaseDetail || "unknown"}' must have an events array — got \${typeof frame.events}\`,
  );
}
`;
  runEsm(script);
});

test("runtime records tick frames and fulfillment", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from ${JSON.stringify(RUNTIME_MODULE)};

const buffer = await readFile(${JSON.stringify(WASM_PATH)});
const { instance } = await WebAssembly.instantiate(buffer, {
  env: {
    abort(_msg, _file, line, column) {
      throw new Error(\`WASM abort at \${line}:\${column}\`);
    },
  },
});
const exports = instance.exports;
const core = {
  init: exports.init,
  step: exports.step,
  applyAction: exports.applyAction,
  getCounter: exports.getCounter,
  setBudget: exports.setBudget,
  getBudget: exports.getBudget,
  getBudgetUsage: exports.getBudgetUsage,
  getEffectCount: exports.getEffectCount,
  getEffectKind: exports.getEffectKind,
  getEffectValue: exports.getEffectValue,
  clearEffects: exports.clearEffects,
  version: exports.version,
};

const runtime = createRuntime({ core, adapters: {} });
await runtime.init({ seed: -1, simConfig: null });
let frames = runtime.getTickFrames();
assert.equal(frames.length, 1);
assert.equal(frames[0].phaseDetail, "init");
assert.ok(Array.isArray(frames[0].emittedEffects));
assert.equal(frames[0].emittedEffects.length, 1);
assert.ok(Array.isArray(frames[0].fulfilledEffects));
assert.ok(frames[0].fulfilledEffects[0].effect);
assert.equal(frames[0].fulfilledEffects[0].status, "deferred");
assert.equal(frames[0].fulfilledEffects[0].reason, "missing_logger");

await runtime.step();
frames = runtime.getTickFrames();
assert.equal(frames.length, 6);
const phaseDetails = frames.slice(1).map((frame) => frame.phaseDetail);
assert.deepEqual(phaseDetails, ["observe", "decide", "apply", "emit", "summarize"]);
const emitFrame = frames.find((frame) => frame.phaseDetail === "emit");
assert.ok(emitFrame);
assert.ok(Array.isArray(emitFrame.fulfilledEffects));
`;
  runEsm(script);
});

/*
## TODO: Test Permutations
- apply frame events include resource_captured entry when actor steps on a resource tile
- apply frame events include vital_delta with correct vitalKind, delta, mode on capture
- apply frame events include trap_triggered entry when actor enters an affinity hazard tile
- events array is empty (not absent) on frames where no observable events occur
- summarize frame includes a summary of all events emitted during the tick
- resource_captured event specifies actorId, tilePosition, vitalKind, delta, and newCurrent
- multiple resource captures in one tick: each produces a distinct event entry
*/
