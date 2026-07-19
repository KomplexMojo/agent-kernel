/**
 * Motivation Pipeline End-to-End Integration Test
 *
 * Validates the full data flow:
 *   Actor motivations (normalized)
 *   -> core evaluation accumulator
 *   -> bindings reader (readMotivationEvaluation)
 *   -> verify behavior profile
 *
 * (The cost half of this pipeline was deleted in P1.2 — core's cost
 * accumulator and readMotivationCost had zero production consumers; pricing
 * is Allocator policy. Motivation pricing is covered by
 * tests/personas/allocator/allocator-price-census.test.js.)
 */

const assert = require("node:assert/strict");

test("motivation pipeline e2e: normalize -> core eval -> binding reader -> verify profile", async () => {
  const {
    createCore,
    MOTIVATION_KIND_BY_CODE,
    readMotivationEvaluation,
  } = await import("../../packages/core-ts/src/index.ts");

  const core = createCore();
  core.init(0);

  // ── Scenario 1: Warden with exploring + defending motivations ──

  const EXPLORING = 3;
  const DEFENDING = 6;

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

  // ── Scenario 2: Empty motivations produce a neutral profile ──

  core.resetMotivationEvaluation();
  const emptyEval = readMotivationEvaluation(core);
  assert.equal(emptyEval.flags, 0, "empty flags");
  assert.deepEqual(emptyEval.flagNames, [], "empty flagNames");
  assert.equal(emptyEval.mobilityName, "stationary", "empty mobility");
  assert.equal(emptyEval.combatName, "none", "empty combat");

  // ── Scenario 3: Single high-intensity attacking motivation ──

  core.resetMotivationEvaluation();

  const ATTACKING = 5;
  core.addMotivationEvaluationEntry(ATTACKING, 8, 1, 0); // melee variant
  core.evaluateMotivations();

  const attackEval = readMotivationEvaluation(core);
  assert.equal(attackEval.combatName, "attacking", "combat = attacking");
  assert.ok(attackEval.flagNames.includes("aggroRangeBoost"), "aggroRangeBoost flag from attacking");
  assert.ok(attackEval.flagNames.includes("canMove"), "canMove from attacking");

  // ── Scenario 4: Sequential evaluations after reset are independent ──

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(EXPLORING, 1, 0, 0);
  core.evaluateMotivations();
  assert.equal(readMotivationEvaluation(core).combatName, "none", "exploring alone has no combat");

  core.resetMotivationEvaluation();
  core.addMotivationEvaluationEntry(DEFENDING, 5, 0, 0);
  core.evaluateMotivations();
  assert.equal(readMotivationEvaluation(core).combatName, "defending", "defending after reset");
});

test("motivation pipeline e2e permutations cover evaluation profiles", async () => {
  const {
    createCore,
    readMotivationEvaluation,
  } = await import("../../packages/core-ts/src/index.ts");

  const core = createCore();
  core.init(0);

  assert.equal(core.normalizeMotivationIntensity(15), 10);
  assert.equal(core.normalizeMotivationIntensity(-3), 1);

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
