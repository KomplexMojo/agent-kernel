const test = require("node:test");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const RUNTIME_MODULE = moduleUrl("packages/runtime/src/runner/runtime.js");

test("runtime loads multi-actor initial state into core", (t) => {
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
  clearActorPlacements: exports.clearActorPlacements,
  addActorPlacement: exports.addActorPlacement,
  validateActorPlacement: exports.validateActorPlacement,
  applyActorPlacements: exports.applyActorPlacements,
  setMotivatedActorVital: exports.setMotivatedActorVital,
  setMotivatedActorMovementCost: exports.setMotivatedActorMovementCost,
  setMotivatedActorActionCostMana: exports.setMotivatedActorActionCostMana,
  setMotivatedActorActionCostStamina: exports.setMotivatedActorActionCostStamina,
  validateActorCapabilities: exports.validateActorCapabilities,
  getMotivatedActorCount: exports.getMotivatedActorCount,
  getMotivatedActorXByIndex: exports.getMotivatedActorXByIndex,
  getMotivatedActorYByIndex: exports.getMotivatedActorYByIndex,
  getMotivatedActorVitalCurrentByIndex: exports.getMotivatedActorVitalCurrentByIndex,
  getMotivatedActorMovementCostByIndex: exports.getMotivatedActorMovementCostByIndex,
  getMotivatedActorActionCostManaByIndex: exports.getMotivatedActorActionCostManaByIndex,
  getMotivatedActorActionCostStaminaByIndex: exports.getMotivatedActorActionCostStaminaByIndex,
};

const simConfig = JSON.parse(
  await readFile(${JSON.stringify(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"))}, "utf8"),
);
const initialState = JSON.parse(
  await readFile(${JSON.stringify(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-mvp-multi.json"))}, "utf8"),
);

const runtime = createRuntime({ core, adapters: {} });
runtime.init({ seed: 0, simConfig, initialState });

assert.equal(core.getMotivatedActorCount(), 3);
assert.deepEqual(
  { x: core.getMotivatedActorXByIndex(0), y: core.getMotivatedActorYByIndex(0) },
  { x: 1, y: 1 },
);
assert.deepEqual(
  { x: core.getMotivatedActorXByIndex(1), y: core.getMotivatedActorYByIndex(1) },
  { x: 2, y: 1 },
);
assert.deepEqual(
  { x: core.getMotivatedActorXByIndex(2), y: core.getMotivatedActorYByIndex(2) },
  { x: 1, y: 2 },
);
assert.equal(core.getMotivatedActorVitalCurrentByIndex(0, 0), 10);
assert.equal(core.getMotivatedActorVitalCurrentByIndex(1, 0), 20);
assert.equal(core.getMotivatedActorVitalCurrentByIndex(2, 0), 30);
assert.equal(core.getMotivatedActorMovementCostByIndex(0), 1);
assert.equal(core.getMotivatedActorActionCostManaByIndex(0), 0);
assert.equal(core.getMotivatedActorActionCostStaminaByIndex(0), 0);
assert.equal(core.getMotivatedActorMovementCostByIndex(1), 2);
assert.equal(core.getMotivatedActorActionCostManaByIndex(1), 1);
assert.equal(core.getMotivatedActorActionCostStaminaByIndex(1), 0);
assert.equal(core.getMotivatedActorMovementCostByIndex(2), 1);
assert.equal(core.getMotivatedActorActionCostManaByIndex(2), 0);
assert.equal(core.getMotivatedActorActionCostStaminaByIndex(2), 2);
assert.equal(core.getActorX(), 1);
assert.equal(core.getActorY(), 1);
`;
  runEsm(script);
});
