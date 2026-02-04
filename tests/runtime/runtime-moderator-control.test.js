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
  getEffectCount() { return 0; },
  getEffectKind() { return 0; },
  getEffectValue() { return 0; },
  clearEffects() {},
};

const runtime = createRuntime({ core, adapters: {} });
await runtime.init({ seed: 0 });

await runtime.step({ controlEvent: "pause" });
let frames = runtime.getTickFrames();
let summarizeFrames = frames.filter((frame) => frame.phaseDetail === "summarize");
let last = summarizeFrames[summarizeFrames.length - 1];
assert.equal(last.personaViews.moderator.state, "pausing");

await runtime.step({ controlEvent: "resume" });
frames = runtime.getTickFrames();
summarizeFrames = frames.filter((frame) => frame.phaseDetail === "summarize");
last = summarizeFrames[summarizeFrames.length - 1];
assert.equal(last.personaViews.moderator.state, "ticking");

await runtime.step({ controlEvent: "stop" });
frames = runtime.getTickFrames();
summarizeFrames = frames.filter((frame) => frame.phaseDetail === "summarize");
last = summarizeFrames[summarizeFrames.length - 1];
assert.equal(last.personaViews.moderator.state, "stopping");
`;

test("runtime routes control events to moderator", () => {
  runEsm(script);
});
