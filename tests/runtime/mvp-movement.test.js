const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

test("runtime default movement generates golden actions and frames", async () => {
  const [{ createCore }, { runMvpMovement }] = await Promise.all([
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/runtime/src/index.js"),
  ]);

  const core = createCore();
  const actionFixture = readFixture("action-sequence-v1-mvp-to-exit.json");
  const frameFixture = readFixture("frame-buffer-log-v1-mvp.json");

  const { actions, frames, baseTiles } = runMvpMovement({ core });
  assert.deepEqual(actions, actionFixture.actions);
  assert.deepEqual(frames.map((f) => f.buffer), frameFixture.frames.map((f) => f.buffer));
  assert.deepEqual(baseTiles, frameFixture.baseTiles);
});
