const assert = require("node:assert/strict");

test("core-ts factory returns the TypeScript core synchronously", async () => {
  const { createCore } = await import("../../packages/core-ts/src/index.ts");

  const core = createCore();
  core.init(7);
  core.step();

  assert.equal(core.getCounter(), 8);
  assert.equal(core.version(), 1);
});
