const test = require("node:test");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const RUNTIME_MODULE = moduleUrl("packages/runtime/src/runner/runtime.js");

test("runtime applies budget caps from SimConfig", (t) => {
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

const runtime = createRuntime({ core, adapters: {}, personas: { actor: stubActor } });
await runtime.init({ seed: 0, simConfig });
await runtime.step();

const effectLog = runtime.getEffectLog();
const limitEntries = effectLog.filter((entry) => entry.kind === "limit_violation");
assert.equal(limitEntries.length, 2, "Expected two limit_violation entries (reached + violated)");
`;
  runEsm(script);
});
