const assert = require("node:assert/strict");

async function createRuntimeWithCore(options = {}) {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  return createRuntime({ core: createCore(), adapters: {}, ...options });
}

test("runtime tick frames include an events array on every phase frame", async () => {
  const runtime = await createRuntimeWithCore();
  await runtime.init({ seed: -1, simConfig: null });
  await runtime.step();
  const frames = runtime.getTickFrames();

  assert.ok(frames.length > 0, "must have at least one frame after init+step");
  for (const frame of frames) {
    assert.ok(
      Array.isArray(frame.events),
      `frame '${frame.phaseDetail || "unknown"}' must have an events array; got ${typeof frame.events}`,
    );
  }
});

test("runtime records tick frames and fulfillment", async () => {
  const runtime = await createRuntimeWithCore();
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
});

test.skip("apply frame events include resource_captured when an actor steps on a resource tile", async () => {
  const runtime = await createRuntimeWithCore();
  await runtime.init({ seed: -1, simConfig: null });
  await runtime.step();
  const applyFrame = runtime.getTickFrames().find((frame) => frame.phaseDetail === "apply");
  assert.ok(applyFrame.events.some((event) => event.kind === "resource_captured"));
});

test.skip("apply frame events include vital_delta with vitalKind, delta, and mode on capture", async () => {
  const runtime = await createRuntimeWithCore();
  await runtime.init({ seed: -1, simConfig: null });
  await runtime.step();
  const applyFrame = runtime.getTickFrames().find((frame) => frame.phaseDetail === "apply");
  assert.ok(applyFrame.events.some((event) => event.kind === "vital_delta" && event.vitalKind && Number.isFinite(event.delta) && event.mode));
});

test.skip("apply frame events include trap_triggered when an actor enters an affinity hazard tile", async () => {
  const runtime = await createRuntimeWithCore();
  await runtime.init({ seed: -1, simConfig: null });
  await runtime.step();
  const applyFrame = runtime.getTickFrames().find((frame) => frame.phaseDetail === "apply");
  assert.ok(applyFrame.events.some((event) => event.kind === "trap_triggered"));
});
