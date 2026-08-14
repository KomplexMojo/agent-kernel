const assert = require("node:assert/strict");

/**
 * P3.1 — the moderator's "pausing" state must gate real tick advancement, not
 * just record a label. Replaces tests/runtime/runtime-moderator-control.test.js,
 * which only asserted the state-machine label changed (pausing/ticking/stopping)
 * and never checked that step() actually stopped doing anything while paused.
 */

function makeFakeCore() {
  return {
    init() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return 0; },
    getEffectKind() { return 0; },
    getEffectValue() { return 0; },
    clearEffects() {},
  };
}

test("step() refuses to advance the tick while the moderator is pausing", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const runtime = createRuntime({ core: makeFakeCore(), adapters: {} });
  await runtime.init({ seed: 0 });

  await runtime.step({});
  const framesAfterFirstTick = runtime.getTickFrames().length;
  assert.ok(framesAfterFirstTick > 0, "the first tick should record frames");

  // Requesting pause: the moderator transitions ticking -> pausing during this
  // call, but the tick already in flight still completes (only the NEXT call,
  // which begins already-paused, is gated).
  await runtime.step({ controlEvent: "pause" });
  const framesAfterPauseRequest = runtime.getTickFrames().length;
  assert.ok(framesAfterPauseRequest > framesAfterFirstTick, "the tick that requests pause must still complete");
  const pausedFrame = runtime.getTickFrames().at(-1);
  assert.equal(pausedFrame.personaViews.moderator.state, "pausing");

  // Refused advance: entering this call already "pausing", no resume requested.
  await runtime.step({});
  assert.equal(
    runtime.getTickFrames().length,
    framesAfterPauseRequest,
    "step() must not record any new frames while paused",
  );

  // Refused again — proves the gate holds across repeated calls, not a one-shot skip.
  await runtime.step({});
  assert.equal(
    runtime.getTickFrames().length,
    framesAfterPauseRequest,
    "repeated calls stay refused while still paused",
  );

  // Resume unblocks: the same call both transitions state and completes a tick.
  await runtime.step({ controlEvent: "resume" });
  const framesAfterResume = runtime.getTickFrames().length;
  assert.ok(framesAfterResume > framesAfterPauseRequest, "resume must allow the tick to advance again");
  const resumedFrame = runtime.getTickFrames().at(-1);
  assert.equal(resumedFrame.personaViews.moderator.state, "ticking");
});

test("step() still transitions moderator state label correctly across pause/resume/stop", async () => {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");

  const runtime = createRuntime({ core: makeFakeCore(), adapters: {} });
  await runtime.init({ seed: 0 });

  await runtime.step({ controlEvent: "pause" });
  assert.equal(runtime.getTickFrames().at(-1).personaViews.moderator.state, "pausing");

  await runtime.step({ controlEvent: "resume" });
  assert.equal(runtime.getTickFrames().at(-1).personaViews.moderator.state, "ticking");

  await runtime.step({ controlEvent: "stop" });
  assert.equal(runtime.getTickFrames().at(-1).personaViews.moderator.state, "stopping");
});
