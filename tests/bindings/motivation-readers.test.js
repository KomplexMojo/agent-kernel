const assert = require("node:assert/strict");

test("motivation bindings: code maps, readMotivationCost, readMotivationEvaluation", async () => {
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
    readMotivationCost,
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

  // ── readMotivationCost ──

  core.resetMotivationCostAccumulator();
  core.addMotivationCostEntry(5, 3); // attacking, intensity=3
  core.addMotivationCostEntry(9, 1); // reflexive, intensity=1

  const cost = readMotivationCost(core);
  assert.ok(cost.total > 0, "total > 0");
  assert.equal(cost.lines.length, 2, "two cost lines");

  // First line: attacking
  assert.equal(cost.lines[0].kind, 5);
  assert.equal(cost.lines[0].kindName, "attacking");
  assert.equal(cost.lines[0].quantity, 3);
  assert.ok(cost.lines[0].unitCost > 0, "attacking unit cost > 0");
  assert.equal(cost.lines[0].spend, cost.lines[0].quantity * cost.lines[0].unitCost, "spend = qty * unit");

  // Second line: reflexive
  assert.equal(cost.lines[1].kind, 9);
  assert.equal(cost.lines[1].kindName, "reflexive");
  assert.equal(cost.lines[1].quantity, 1);

  // Total matches sum of spends
  assert.equal(cost.total, cost.lines[0].spend + cost.lines[1].spend, "total = sum of spends");

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

  // ── readMotivationCost: empty ──

  core.resetMotivationCostAccumulator();
  const emptyCost = readMotivationCost(core);
  assert.equal(emptyCost.total, 0, "empty total");
  assert.equal(emptyCost.lines.length, 0, "empty lines");

  // ── Core codebook exports through bindings ──

  assert.equal(core.getMotivationKindCount(), 12, "12 kinds");
  assert.equal(core.getMotivationFamily(5), 1, "attacking is posture");
  assert.equal(core.getMotivationTier(5), 0, "attacking is simple tier");
  assert.equal(core.normalizeMotivationIntensity(15), 10, "clamps to max");
  assert.equal(core.normalizeMotivationIntensity(-3), 1, "clamps to min");
});

// ## TODO: Test Permutations
// - [ ] All 12 motivation kinds: verify kindName round-trip through code map
// - [ ] readMotivationCost with all 12 kinds: verify lineCount matches entry count
// - [ ] readMotivationCost with max intensity (10): verify spend = 10 * unitCost
// - [ ] readMotivationEvaluation with strategy_focused: verify reasoningClassName = "strategic"
// - [ ] readMotivationEvaluation with stealthy + defending: verify flagNames includes prefersStealth + prefersCover
// - [ ] readMotivationEvaluation with user_controlled alone: verify all axes stationary/none/none
// - [ ] Code map completeness: every code in core range has a name entry
// - [ ] Multiple sequential cost accumulations: verify reset clears previous state
// - [ ] Core codebook exports available through createCore: all 7 codebook functions callable
