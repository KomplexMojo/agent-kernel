const test = require("node:test");
const assert = require("node:assert/strict");

test("legacy motivations normalize into layered motivation profiles", async () => {
  const {
    deriveMotivationProfile,
    deriveReasoningClass,
    buildMotivationCostItems,
  } = await import("../../packages/runtime/src/personas/configurator/motivation-loadouts.js");

  assert.deepEqual(
    deriveMotivationProfile(["stationary"]),
    { mobility: "stationary", combat: "none", cognition: "none" },
  );
  assert.deepEqual(
    deriveMotivationProfile(["exploring"]),
    { mobility: "exploring", combat: "none", cognition: "reflexive" },
  );
  assert.deepEqual(
    deriveMotivationProfile(["attacking"]),
    { mobility: "exploring", combat: "attacking", cognition: "goal_oriented" },
  );
  assert.deepEqual(
    deriveMotivationProfile(["patrolling", "defending"]),
    { mobility: "patrolling", combat: "defending", cognition: "goal_oriented" },
  );
  assert.equal(
    deriveReasoningClass(deriveMotivationProfile(["attacking"])),
    "tactical",
  );
  assert.deepEqual(
    buildMotivationCostItems({ mobility: "exploring", combat: "attacking", cognition: "strategy_focused" }),
    [
      { axis: "mobility", value: "exploring", id: "mobility_exploring", defaultCostTokens: 1 },
      { axis: "combat", value: "attacking", id: "combat_attacking", defaultCostTokens: 5 },
      { axis: "cognition", value: "strategy_focused", id: "cognition_strategy_focused", defaultCostTokens: 20 },
    ],
  );
});

test("normalizeMotivations annotates reasoning metadata and preserves compatibility kinds", async () => {
  const { normalizeMotivations } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations(["attacking", "strategy_focused"]);
  assert.equal(result.ok, true);
  assert.equal(result.value[0].kind, "attacking");
  assert.deepEqual(result.value[0].motivationProfile, {
    mobility: "exploring",
    combat: "attacking",
    cognition: "goal_oriented",
  });
  assert.equal(result.value[0].reasoningClass, "tactical");
});
