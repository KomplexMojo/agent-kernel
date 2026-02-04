const test = require("node:test");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const RUNTIME_MODULE = moduleUrl("packages/runtime/src/runner/runtime.js");

test("runtime applies configurator sim config and initial state artifacts", (t) => {
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
  configureGrid: exports.configureGrid,
  setTileAt: exports.setTileAt,
  spawnActorAt: exports.spawnActorAt,
  setActorVital: exports.setActorVital,
  getActorVitalCurrent: exports.getActorVitalCurrent,
  getActorVitalMax: exports.getActorVitalMax,
  getActorVitalRegen: exports.getActorVitalRegen,
  getMapWidth: exports.getMapWidth,
  getMapHeight: exports.getMapHeight,
  getActorX: exports.getActorX,
  getActorY: exports.getActorY,
  getTileActorKind: exports.getTileActorKind,
  renderBaseCellChar: exports.renderBaseCellChar,
  setBudget: exports.setBudget,
  getBudget: exports.getBudget,
  getBudgetUsage: exports.getBudgetUsage,
  getEffectCount: exports.getEffectCount,
  getEffectKind: exports.getEffectKind,
  getEffectValue: exports.getEffectValue,
  clearEffects: exports.clearEffects,
  version: exports.version,
};

const simConfig = JSON.parse(
  await readFile(${JSON.stringify(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json"))}, "utf8"),
);
const initialState = JSON.parse(
  await readFile(${JSON.stringify(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json"))}, "utf8"),
);

const runtime = createRuntime({ core, adapters: {} });
await runtime.init({ seed: 0, simConfig, initialState });

assert.equal(core.getMapWidth(), 5);
assert.equal(core.getMapHeight(), 5);
assert.equal(core.getActorX(), 2);
assert.equal(core.getActorY(), 1);
assert.equal(core.getActorVitalCurrent(0), 11);
assert.equal(core.getActorVitalMax(0), 12);
assert.equal(core.getActorVitalMax(1), 2);
assert.equal(String.fromCharCode(core.renderBaseCellChar(2, 1)), "S");
assert.equal(String.fromCharCode(core.renderBaseCellChar(3, 2)), "E");
assert.equal(core.getTileActorKind(2, 2), 0);
`;
  runEsm(script);
});
