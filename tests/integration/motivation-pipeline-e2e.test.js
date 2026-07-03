/**
 * Motivation Pipeline End-to-End Integration Test
 *
 * Validates the full data flow:
 *   Actor motivations (normalized)
 *   -> core cost accumulator + evaluation
 *   -> bindings readers (readMotivationCost, readMotivationEvaluation)
 *   -> verify cost line items and behavior profile
 *
 * This test exercises the pipeline from the runtime through bindings
 * to the TypeScript core and back:
 *   runtime normalization -> core-ts -> core-ts readers
 */

const assert = require("node:assert/strict");

test("motivation pipeline e2e: normalize -> core cost/eval -> binding readers -> verify line items", async () => {
  const {
    createCore,
    MOTIVATION_KIND_BY_CODE,
    readMotivationCost,
    readMotivationEvaluation,
  } = await import("../../packages/core-ts/src/index.ts");

  const core = createCore();
  core.init(0);

  // ── Scenario 1: Warden with exploring + defending motivations ──

  core.resetMotivationCostAccumulator();
  core.resetMotivationEvaluation();

  const EXPLORING = 3;
  const DEFENDING = 6;

  // Add cost entries
  core.addMotivationCostEntry(EXPLORING, 2);
  core.addMotivationCostEntry(DEFENDING, 3);

  const cost = readMotivationCost(core);
  assert.equal(cost.lines.length, 2, "two cost lines");

  // Verify exploring line
  const exploringLine = cost.lines.find((l) => l.kindName === "exploring");
  assert.ok(exploringLine, "exploring line present");
  assert.equal(exploringLine.quantity, 2, "exploring quantity = 2");
  assert.ok(exploringLine.unitCost > 0, "exploring has unit cost");
  assert.equal(exploringLine.spend, exploringLine.quantity * exploringLine.unitCost, "spend = qty * unit");

  // Verify defending line
  const defendingLine = cost.lines.find((l) => l.kindName === "defending");
  assert.ok(defendingLine, "defending line present");
  assert.equal(defendingLine.quantity, 3, "defending quantity = 3");
  assert.ok(defendingLine.unitCost > 0, "defending has unit cost");
  assert.equal(defendingLine.spend, defendingLine.quantity * defendingLine.unitCost, "spend = qty * unit");

  // Verify total
  assert.equal(cost.total, exploringLine.spend + defendingLine.spend, "total = sum of spends");
  assert.ok(cost.total > 0, "total > 0");

  // ── Scenario 1b: Evaluate behavior profile ──

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(EXPLORING, 2, 0, 0);
  core.addMotivationEvaluationEntry(DEFENDING, 3, 0, 0);
  core.evaluateMotivations();

  const evaluation = readMotivationEvaluation(core);

  assert.ok(evaluation.flags & 1, "canMove set (from exploring or defending)");
  assert.ok(evaluation.flagNames.includes("canMove"), "flagNames has canMove");

  // Profile axes
  assert.equal(evaluation.mobilityName, "exploring", "mobility = exploring from exploring motivation");
  assert.equal(evaluation.combatName, "defending", "combat = defending from defending motivation");
  assert.ok(["instinctual", "tactical"].includes(evaluation.reasoningClassName),
    "reasoning is instinctual or tactical");

  // Numeric codes match names
  assert.equal(MOTIVATION_KIND_BY_CODE[EXPLORING], "exploring");
  assert.equal(MOTIVATION_KIND_BY_CODE[DEFENDING], "defending");

  // ── Scenario 2: Empty motivations produce zero cost ──

  core.resetMotivationCostAccumulator();
  const emptyCost = readMotivationCost(core);
  assert.equal(emptyCost.total, 0, "empty total");
  assert.equal(emptyCost.lines.length, 0, "empty lines");

  core.resetMotivationEvaluation();
  const emptyEval = readMotivationEvaluation(core);
  assert.equal(emptyEval.flags, 0, "empty flags");
  assert.deepEqual(emptyEval.flagNames, [], "empty flagNames");
  assert.equal(emptyEval.mobilityName, "stationary", "empty mobility");
  assert.equal(emptyEval.combatName, "none", "empty combat");

  // ── Scenario 3: Single high-intensity attacking motivation ──

  core.resetMotivationCostAccumulator();
  core.resetMotivationEvaluation();

  const ATTACKING = 5;
  core.addMotivationCostEntry(ATTACKING, 8);

  const attackCost = readMotivationCost(core);
  assert.equal(attackCost.lines.length, 1, "one cost line");
  assert.equal(attackCost.lines[0].kindName, "attacking", "attacking kind");
  assert.equal(attackCost.lines[0].quantity, 8, "quantity = 8");
  assert.ok(attackCost.total > 0, "attacking cost > 0");

  core.addMotivationEvaluationEntry(ATTACKING, 8, 1, 0); // melee variant
  core.evaluateMotivations();

  const attackEval = readMotivationEvaluation(core);
  assert.equal(attackEval.combatName, "attacking", "combat = attacking");
  assert.ok(attackEval.flagNames.includes("aggroRangeBoost"), "aggroRangeBoost flag from attacking");
  assert.ok(attackEval.flagNames.includes("canMove"), "canMove from attacking");

  // ── Scenario 4: Sequential accumulations after reset are independent ──

  core.resetMotivationCostAccumulator();
  core.addMotivationCostEntry(EXPLORING, 1);
  const firstCost = readMotivationCost(core);

  core.resetMotivationCostAccumulator();
  core.addMotivationCostEntry(DEFENDING, 5);
  const secondCost = readMotivationCost(core);

  assert.notEqual(firstCost.total, secondCost.total, "different costs after reset");
  assert.equal(secondCost.lines.length, 1, "only defending after reset");
  assert.equal(secondCost.lines[0].kindName, "defending", "defending after reset");
});

test("motivation pipeline e2e permutations cover codebook costs and evaluation profiles", async () => {
  const {
    createCore,
    MOTIVATION_KIND_BY_CODE,
    readMotivationCost,
    readMotivationEvaluation,
  } = await import("../../packages/core-ts/src/index.ts");

  const core = createCore();
  core.init(0);

  assert.equal(core.normalizeMotivationIntensity(15), 10);
  assert.equal(core.normalizeMotivationIntensity(-3), 1);

  core.resetMotivationCostAccumulator();
  for (let kind = 1; kind <= 12; kind += 1) {
    core.addMotivationCostEntry(kind, 5);
  }
  const allKindsCost = readMotivationCost(core);
  assert.equal(allKindsCost.lines.length, 12);
  for (const line of allKindsCost.lines) {
    assert.equal(line.kindName, MOTIVATION_KIND_BY_CODE[line.kind]);
    assert.equal(line.quantity, 5);
    assert.equal(line.spend, line.unitCost * line.quantity);
  }
  assert.equal(
    allKindsCost.total,
    allKindsCost.lines.reduce((sum, line) => sum + line.spend, 0),
  );

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(3, 2, 0, 0);  // exploring
  core.addMotivationEvaluationEntry(5, 4, 1, 0);  // attacking
  core.addMotivationEvaluationEntry(11, 3, 0, 0); // strategy_focused
  core.evaluateMotivations();
  const maxWins = readMotivationEvaluation(core);
  assert.equal(maxWins.mobilityName, "exploring");
  assert.equal(maxWins.combatName, "attacking");
  assert.equal(maxWins.cognitionName, "strategy_focused");
  assert.equal(maxWins.reasoningClassName, "strategic");

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(12, 1, 0, 0); // user_controlled
  core.evaluateMotivations();
  const controlled = readMotivationEvaluation(core);
  assert.equal(controlled.mobilityName, "stationary");
  assert.equal(controlled.combatName, "none");
  assert.equal(controlled.cognitionName, "none");

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(7, 1, 0, 0);  // stealthy
  core.addMotivationEvaluationEntry(10, 1, 0, 0); // goal_oriented
  core.evaluateMotivations();
  const stealthGoal = readMotivationEvaluation(core);
  assert.ok(stealthGoal.flagNames.includes("prefersStealth"));
  assert.equal(stealthGoal.cognitionName, "goal_oriented");

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(5, 1, 0, 0); // attacking
  core.addMotivationEvaluationEntry(6, 1, 0, 0); // defending
  core.addMotivationEvaluationEntry(7, 1, 0, 0); // stealthy
  core.evaluateMotivations();
  const flags = readMotivationEvaluation(core);
  for (const expected of ["canMove", "aggroRangeBoost", "prefersCover", "prefersStealth"]) {
    assert.ok(flags.flagNames.includes(expected), `expected ${expected} flag`);
  }
});

test.skip("motivation pipeline mixed user_controlled plus mobility override is pending control-family arbitration", () => {});
