const assert = require("node:assert/strict");

test("runtime runner produces tick frames", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig: null });
  await runtime.step();
  const frames = runtime.getTickFrames();
  assert.ok(Array.isArray(frames));
  assert.ok(frames.length > 0);
});
