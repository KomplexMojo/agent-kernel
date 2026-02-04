const test = require("node:test");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const RUNTIME_MODULE = moduleUrl("packages/runtime/src/runner/runtime.js");

const SIM_CONFIG_PATH = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json");
const INITIAL_STATE_PATH = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json");

// This test ensures the runtime schedules all personas when inputs are available.
test("runtime drives all personas via the FSM schedule", (t) => {
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
  setMoveAction: exports.setMoveAction,
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
  getActorKind: exports.getActorKind,
  getTileActorKind: exports.getTileActorKind,
  renderBaseCellChar: exports.renderBaseCellChar,
  getCurrentTick: exports.getCurrentTick,
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

const simConfig = JSON.parse(await readFile(${JSON.stringify(SIM_CONFIG_PATH)}, "utf8"));
const initialState = JSON.parse(await readFile(${JSON.stringify(INITIAL_STATE_PATH)}, "utf8"));
const intentEnvelope = {
  schema: "agent-kernel/IntentEnvelope",
  schemaVersion: 1,
  meta: {
    id: "intent_runtime_schedule",
    runId: "run_runtime_schedule",
    createdAt: "2025-01-01T00:00:00.000Z",
    producedBy: "test",
  },
  source: "test",
  intent: { goal: "Reach the exit", tags: ["runtime", "schedule"] },
};

const runtime = createRuntime({ core, adapters: {} });
await runtime.init({ seed: 0, simConfig, initialState, runId: "run_runtime_schedule", intentEnvelope });
await runtime.step();
await runtime.step();
await runtime.step();
await runtime.step();

const frames = runtime.getTickFrames();
const summarizeFrames = frames.filter((frame) => frame.phaseDetail === "summarize");
const last = summarizeFrames[summarizeFrames.length - 1];
assert.ok(last, "Expected a summarize frame");

const views = last.personaViews;
assert.equal(views.orchestrator.state, "running");
assert.equal(views.director.state, "ready");
assert.ok(["monitoring", "rebalancing"].includes(views.allocator.state));
assert.equal(views.moderator.state, "ticking");
assert.equal(views.configurator.state, "configured");
`;

  runEsm(script);
});
