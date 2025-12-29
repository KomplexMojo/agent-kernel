const test = require("node:test");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const RUNTIME_MODULE = moduleUrl("packages/runtime/src/runner/runtime.js");

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
runtime.init({ seed: -1, simConfig: null });
let frames = runtime.getTickFrames();
assert.equal(frames.length, 1);
assert.equal(frames[0].phaseDetail, "init");
assert.ok(Array.isArray(frames[0].emittedEffects));
assert.equal(frames[0].emittedEffects.length, 1);
assert.ok(Array.isArray(frames[0].fulfilledEffects));
assert.ok(frames[0].fulfilledEffects[0].effect);
assert.equal(frames[0].fulfilledEffects[0].status, "deferred");
assert.equal(frames[0].fulfilledEffects[0].reason, "missing_logger");

runtime.step();
frames = runtime.getTickFrames();
assert.equal(frames.length, 5);
const phaseDetails = frames.slice(1).map((frame) => frame.phaseDetail);
assert.deepEqual(phaseDetails, ["observe", "collect", "apply", "emit"]);
const emitFrame = frames[frames.length - 1];
assert.ok(Array.isArray(emitFrame.fulfilledEffects));
assert.ok(emitFrame.fulfilledEffects.length > 0);
const record = emitFrame.fulfilledEffects[0];
assert.ok(record.effect);
assert.equal(record.status, "deferred");
assert.equal(record.reason, "missing_logger");
`;
  runEsm(script);
});
