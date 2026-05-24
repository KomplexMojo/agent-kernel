const assert = require("node:assert/strict");



test("runtime routes control events to moderator", async () => {
const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");

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
});
