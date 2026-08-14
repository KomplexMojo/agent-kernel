const assert = require("node:assert/strict");

// readMotivationCost and core's cost accumulator were deleted in P1.2 —
// pricing is Allocator policy, not core. This file tests the surviving
// codebook maps and evaluation reader.

test("motivation bindings: code maps, readMotivationEvaluation", async () => {
  const {
    createCore,
    MOTIVATION_KIND_BY_CODE,
    MOTIVATION_FAMILY_BY_CODE,
    MOTIVATION_TIER_BY_CODE,
    MOTIVATION_REASONING_CLASS_BY_CODE,
    MOTIVATION_MOBILITY_BY_CODE,
    MOTIVATION_COMBAT_BY_CODE,
    MOTIVATION_COGNITION_BY_CODE,
    MOTIVATION_FLAG_NAMES,
    readMotivationEvaluation,
  } = await import("../../packages/core-ts/src/index.ts");

  const core = createCore();
  core.init(0);

  // ── Code maps ──

  assert.equal(MOTIVATION_KIND_BY_CODE[1], "random");
  assert.equal(MOTIVATION_KIND_BY_CODE[5], "attacking");
  assert.equal(MOTIVATION_KIND_BY_CODE[12], "user_controlled");
  assert.equal(Object.keys(MOTIVATION_KIND_BY_CODE).length, 12, "12 motivation kinds");

  assert.equal(MOTIVATION_FAMILY_BY_CODE[0], "mobility");
  assert.equal(MOTIVATION_FAMILY_BY_CODE[1], "posture");
  assert.equal(MOTIVATION_FAMILY_BY_CODE[2], "cognition");
  assert.equal(MOTIVATION_FAMILY_BY_CODE[3], "control");

  assert.equal(MOTIVATION_TIER_BY_CODE[0], "simple");
  assert.equal(MOTIVATION_TIER_BY_CODE[1], "advanced");
  assert.equal(MOTIVATION_TIER_BY_CODE[2], "control");

  assert.equal(MOTIVATION_REASONING_CLASS_BY_CODE[0], "instinctual");
  assert.equal(MOTIVATION_REASONING_CLASS_BY_CODE[1], "tactical");
  assert.equal(MOTIVATION_REASONING_CLASS_BY_CODE[2], "strategic");

  assert.equal(MOTIVATION_MOBILITY_BY_CODE[0], "stationary");
  assert.equal(MOTIVATION_MOBILITY_BY_CODE[1], "exploring");
  assert.equal(MOTIVATION_MOBILITY_BY_CODE[2], "patrolling");

  assert.equal(MOTIVATION_COMBAT_BY_CODE[0], "none");
  assert.equal(MOTIVATION_COMBAT_BY_CODE[1], "attacking");
  assert.equal(MOTIVATION_COMBAT_BY_CODE[2], "defending");

  assert.equal(MOTIVATION_COGNITION_BY_CODE[0], "none");
  assert.equal(MOTIVATION_COGNITION_BY_CODE[1], "reflexive");
  assert.equal(MOTIVATION_COGNITION_BY_CODE[2], "goal_oriented");
  assert.equal(MOTIVATION_COGNITION_BY_CODE[3], "strategy_focused");

  assert.equal(MOTIVATION_FLAG_NAMES[1], "canMove");
  assert.equal(MOTIVATION_FLAG_NAMES[8], "aggroRangeBoost");

  // ── readMotivationEvaluation: attacking + reflexive ──

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(5, 3, 1, 0); // attacking, intensity=3, melee, no extra flags
  core.addMotivationEvaluationEntry(9, 1, 0, 0); // reflexive, intensity=1
  core.evaluateMotivations();

  const evaluation = readMotivationEvaluation(core);

  // Attacking has canMove + aggroRangeBoost flags
  assert.ok(evaluation.flags & 1, "canMove set");
  assert.ok(evaluation.flags & 8, "aggroRangeBoost set");
  assert.ok(evaluation.flagNames.includes("canMove"), "flagNames has canMove");
  assert.ok(evaluation.flagNames.includes("aggroRangeBoost"), "flagNames has aggroRangeBoost");

  // Profile axes: max of attacking(exploring/attacking/goal_oriented) and reflexive(stationary/none/reflexive)
  assert.equal(evaluation.mobilityName, "exploring", "mobility = exploring");
  assert.equal(evaluation.combatName, "attacking", "combat = attacking");
  assert.equal(evaluation.cognitionName, "goal_oriented", "cognition = goal_oriented");
  assert.equal(evaluation.reasoningClassName, "tactical", "reasoning = tactical");

  // Numeric codes match names
  assert.equal(evaluation.mobility, 1, "mobility code = 1 (exploring)");
  assert.equal(evaluation.combat, 1, "combat code = 1 (attacking)");
  assert.equal(evaluation.cognition, 2, "cognition code = 2 (goal_oriented)");
  assert.equal(evaluation.reasoningClass, 1, "reasoning code = 1 (tactical)");

  // ── readMotivationEvaluation: empty ──

  core.resetMotivationEvaluation();
  const emptyEval = readMotivationEvaluation(core);
  assert.equal(emptyEval.flags, 0, "empty flags");
  assert.deepEqual(emptyEval.flagNames, [], "empty flagNames");
  assert.equal(emptyEval.mobilityName, "stationary", "empty mobility");
  assert.equal(emptyEval.reasoningClassName, "instinctual", "empty reasoning");

  // ── Core codebook exports through bindings ──

  assert.equal(core.getMotivationKindCount(), 12, "12 kinds");
  assert.equal(core.getMotivationFamily(5), 1, "attacking is posture");
  assert.equal(core.getMotivationTier(5), 0, "attacking is simple tier");
  assert.equal(core.normalizeMotivationIntensity(15), 10, "clamps to max");
  assert.equal(core.normalizeMotivationIntensity(-3), 1, "clamps to min");
});

test("motivation bindings round-trip all 12 kind names", async () => {
  const { MOTIVATION_KIND_BY_CODE } = await import("../../packages/core-ts/src/index.ts");
  assert.deepEqual(Object.values(MOTIVATION_KIND_BY_CODE), [
    "random",
    "stationary",
    "exploring",
    "patrolling",
    "attacking",
    "defending",
    "stealthy",
    "friendly",
    "reflexive",
    "goal_oriented",
    "strategy_focused",
    "user_controlled",
  ]);
});

test("readMotivationEvaluation reports strategic reasoning for strategy_focused", async () => {
  const { createCore, readMotivationEvaluation } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(11, 1, 0, 0);
  core.evaluateMotivations();
  const evaluation = readMotivationEvaluation(core);
  assert.equal(evaluation.cognitionName, "strategy_focused");
  assert.equal(evaluation.reasoningClassName, "strategic");
});

test("readMotivationEvaluation combines stealthy and defending flags", async () => {
  const { createCore, readMotivationEvaluation } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(7, 1, 0, 0);
  core.addMotivationEvaluationEntry(6, 1, 0, 0);
  core.evaluateMotivations();
  const evaluation = readMotivationEvaluation(core);
  assert.ok(evaluation.flagNames.includes("prefersStealth"));
  assert.ok(evaluation.flagNames.includes("prefersCover"));
  assert.equal(evaluation.combatName, "defending");
});

test("readMotivationEvaluation with user_controlled alone keeps neutral axes", async () => {
  const { createCore, readMotivationEvaluation } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(12, 1, 0, 0);
  core.evaluateMotivations();
  const evaluation = readMotivationEvaluation(core);
  assert.equal(evaluation.mobilityName, "stationary");
  assert.equal(evaluation.combatName, "none");
  assert.equal(evaluation.cognitionName, "none");
  assert.equal(evaluation.reasoningClassName, "instinctual");
});

test("motivation code maps cover every core kind code", async () => {
  const { createCore, MOTIVATION_KIND_BY_CODE } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  for (let kind = 1; kind <= core.getMotivationKindCount(); kind += 1) {
    assert.equal(typeof MOTIVATION_KIND_BY_CODE[kind], "string", `kind ${kind} missing name`);
  }
});

test("core motivation codebook functions are callable through createCore", async () => {
  const { createCore } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  [
    "getMotivationKindCount",
    "getMotivationFamily",
    "getMotivationExclusiveGroup",
    "motivationKindsConflict",
    "getMotivationPatternCount",
    "getMotivationPatternCodeAt",
    "getDefaultMotivationPattern",
    "getMotivationTier",
    "normalizeMotivationIntensity",
    "getMotivationDefaultFlagMask",
    "getMotivationFlagCount",
  ].forEach((name) => assert.equal(typeof core[name], "function", `${name} export`));
});
