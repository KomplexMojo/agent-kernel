const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const runtimeModule = moduleUrl("packages/runtime/src/runner/runtime.js");

const script = `
import assert from "node:assert/strict";
import { createRuntime } from ${JSON.stringify(runtimeModule)};

const core = {
  init() {},
  applyAction() {},
  getCounter() { return 0; },
  getEffectCount() { return 1; },
  getEffectKind() { return 1; },
  getEffectValue() { return 0; },
  clearEffects() {},
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

const runtime = createRuntime({
  core,
  adapters: { logger: { log() {}, warn() {}, error() {} } },
});

await runtime.init({ seed: 0, simConfig });
await runtime.step();
await runtime.step();

const frames = runtime.getTickFrames();
const summarizeFrames = frames.filter((frame) => frame.phaseDetail === "summarize");
const last = summarizeFrames[summarizeFrames.length - 1];
assert.equal(last.personaViews.allocator.state, "rebalancing");
`;

test("allocator rebalance transitions are driven by runtime signals", () => {
  runEsm(script);
});
