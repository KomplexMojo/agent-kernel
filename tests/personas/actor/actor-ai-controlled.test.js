/** `ai_controlled` actors propose nothing of their own and follow strategies in full, like `user_controlled`. */
const assert = require("node:assert/strict");

test("ai_controlled proposes nothing and reaches full strategy depth", async () => {
  const { getMotivationModule } = await import("../../../packages/runtime/src/personas/actor/motivations/index.js");
  const { strategyDepth, STRATEGY_DEPTH } = await import("../../../packages/runtime/src/personas/actor/strategy.js");
  assert.deepEqual(getMotivationModule("ai_controlled").propose({}), []);
  assert.equal(strategyDepth(["ai_controlled"]), STRATEGY_DEPTH.FULL);
});
