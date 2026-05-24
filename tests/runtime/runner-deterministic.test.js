const assert = require("node:assert/strict");

test("runtime uses injected runId and clock for deterministic frames", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const fixedClock = () => "2025-01-01T00:00:00.000Z";
  const runtime = createRuntime({ core: createCore(), adapters: {}, runId: "run_fixed", clock: fixedClock });
  await runtime.init({ seed: 0, simConfig: null });
  await runtime.step();

  const frames = runtime.getTickFrames();
  assert.ok(frames.length > 0);
  for (const frame of frames) {
    assert.equal(frame.meta.runId, "run_fixed");
    assert.equal(frame.meta.createdAt, "2025-01-01T00:00:00.000Z");
  }
});
