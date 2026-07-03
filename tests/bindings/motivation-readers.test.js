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

test("readMotivationCost reports one line for each motivation kind", async () => {
  const { createCore, readMotivationCost, MOTIVATION_KIND_BY_CODE } = await import(
    "../../packages/core-ts/src/index.ts"
  );
  const core = createCore();
  core.init(0);
  core.resetMotivationCostAccumulator();
  for (let kind = 1; kind <= 12; kind += 1) {
    core.addMotivationCostEntry(kind, 1);
  }
  const cost = readMotivationCost(core);
  assert.equal(cost.lines.length, 12);
  cost.lines.forEach((line, index) => {
    const kind = index + 1;
    assert.equal(line.kind, kind);
    assert.equal(line.kindName, MOTIVATION_KIND_BY_CODE[kind]);
  });
});

test("readMotivationCost uses max intensity in spend calculation", async () => {
  const { createCore, readMotivationCost } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.resetMotivationCostAccumulator();
  core.addMotivationCostEntry(5, 10);
  const line = readMotivationCost(core).lines[0];
  assert.equal(line.quantity, 10);
  assert.equal(line.spend, 10 * line.unitCost);
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

test("readMotivationCost reset clears previous accumulations", async () => {
  const { createCore, readMotivationCost } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  core.init(0);
  core.resetMotivationCostAccumulator();
  core.addMotivationCostEntry(5, 3);
  assert.equal(readMotivationCost(core).lines.length, 1);
  core.resetMotivationCostAccumulator();
  const cost = readMotivationCost(core);
  assert.equal(cost.total, 0);
  assert.deepEqual(cost.lines, []);
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
    "getMotivationDefaultUnitCost",
    "normalizeMotivationIntensity",
    "getMotivationProfileCost",
    "getMotivationDefaultDesignCost",
    "getMotivationDefaultFlagMask",
    "getMotivationFlagCount",
  ].forEach((name) => assert.equal(typeof core[name], "function", `${name} export`));
});
