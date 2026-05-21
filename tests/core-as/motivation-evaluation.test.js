const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

if (!existsSync(WASM_PATH)) {
  test.skip("WASM not built — skipping motivation evaluation tests", () => {});
} else {
  // ── Profile cost parity with JS globals.profileCosts ──

  test("getMotivationProfileCost matches JS profileCosts sums", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    // Profile costs from DEFAULT_MOTIVATION_RULES_ARTIFACT globals:
    // mobility: stationary=0, exploring=1, patrolling=2
    // combat: none=0, attacking=5, defending=4
    // cognition: none=0, reflexive=1, goal_oriented=5, strategy_focused=20

    // random: exploring(1) + none(0) + reflexive(1) = 2
    assert.equal(core.getMotivationProfileCost(1), 2, "random");
    // stationary: stationary(0) + none(0) + none(0) = 0
    assert.equal(core.getMotivationProfileCost(2), 0, "stationary");
    // exploring: exploring(1) + none(0) + reflexive(1) = 2
    assert.equal(core.getMotivationProfileCost(3), 2, "exploring");
    // patrolling: patrolling(2) + none(0) + reflexive(1) = 3
    assert.equal(core.getMotivationProfileCost(4), 3, "patrolling");
    // attacking: exploring(1) + attacking(5) + goal_oriented(5) = 11
    assert.equal(core.getMotivationProfileCost(5), 11, "attacking");
    // defending: stationary(0) + defending(4) + goal_oriented(5) = 9
    assert.equal(core.getMotivationProfileCost(6), 9, "defending");
    // stealthy: exploring(1) + none(0) + goal_oriented(5) = 6
    assert.equal(core.getMotivationProfileCost(7), 6, "stealthy");
    // friendly: exploring(1) + none(0) + reflexive(1) = 2
    assert.equal(core.getMotivationProfileCost(8), 2, "friendly");
    // reflexive: stationary(0) + none(0) + reflexive(1) = 1
    assert.equal(core.getMotivationProfileCost(9), 1, "reflexive");
    // goal_oriented: stationary(0) + none(0) + goal_oriented(5) = 5
    assert.equal(core.getMotivationProfileCost(10), 5, "goal_oriented");
    // strategy_focused: stationary(0) + none(0) + strategy_focused(20) = 20
    assert.equal(core.getMotivationProfileCost(11), 20, "strategy_focused");
    // user_controlled: stationary(0) + none(0) + none(0) = 0
    assert.equal(core.getMotivationProfileCost(12), 0, "user_controlled");
    // invalid
    assert.equal(core.getMotivationProfileCost(0), -1, "invalid kind 0");
  });

  // ── Default design cost parity ──

  test("getMotivationDefaultDesignCost matches JS defaultDesignCostTokens", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    assert.equal(core.getMotivationDefaultDesignCost(1), 0, "random");
    assert.equal(core.getMotivationDefaultDesignCost(2), 0, "stationary");
    assert.equal(core.getMotivationDefaultDesignCost(5), 0, "attacking");
    assert.equal(core.getMotivationDefaultDesignCost(7), 0, "stealthy");
    assert.equal(core.getMotivationDefaultDesignCost(8), 0, "friendly");
    assert.equal(core.getMotivationDefaultDesignCost(9), 1, "reflexive");
    assert.equal(core.getMotivationDefaultDesignCost(10), 5, "goal_oriented");
    assert.equal(core.getMotivationDefaultDesignCost(11), 20, "strategy_focused");
    assert.equal(core.getMotivationDefaultDesignCost(12), 0, "user_controlled");
  });

  // ── Default flag masks ──

  test("getMotivationDefaultFlagMask: attacking has aggroRangeBoost", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    const CAN_MOVE = 1, PREFERS_STEALTH = 2, PREFERS_COVER = 4, AGGRO_RANGE = 8;

    // attacking: canMove | aggroRangeBoost = 1 | 8 = 9
    assert.equal(core.getMotivationDefaultFlagMask(5), CAN_MOVE | AGGRO_RANGE, "attacking");
    // defending: canMove | prefersCover = 1 | 4 = 5
    assert.equal(core.getMotivationDefaultFlagMask(6), CAN_MOVE | PREFERS_COVER, "defending");
    // stealthy: canMove | prefersStealth = 1 | 2 = 3
    assert.equal(core.getMotivationDefaultFlagMask(7), CAN_MOVE | PREFERS_STEALTH, "stealthy");
    // reflexive: canMove = 1
    assert.equal(core.getMotivationDefaultFlagMask(9), CAN_MOVE, "reflexive");
    // friendly: canMove = 1
    assert.equal(core.getMotivationDefaultFlagMask(8), CAN_MOVE, "friendly");
  });

  // ── Reasoning class from cognition tier ──

  test("evaluateMotivations derives reasoning class from highest cognition", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const INSTINCTUAL = 0, TACTICAL = 1, STRATEGIC = 2;

    // reflexive alone → cognition=reflexive → instinctual
    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(9, 1, 0, 0); // reflexive
    core.evaluateMotivations();
    assert.equal(core.getLastMotivationReasoningClass(), INSTINCTUAL, "reflexive → instinctual");

    // goal_oriented alone → cognition=goal_oriented → tactical
    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(10, 1, 0, 0); // goal_oriented
    core.evaluateMotivations();
    assert.equal(core.getLastMotivationReasoningClass(), TACTICAL, "goal_oriented → tactical");

    // strategy_focused alone → cognition=strategy_focused → strategic
    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(11, 1, 0, 0); // strategy_focused
    core.evaluateMotivations();
    assert.equal(core.getLastMotivationReasoningClass(), STRATEGIC, "strategy_focused → strategic");

    // stationary alone → cognition=none → instinctual
    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(2, 1, 0, 0); // stationary
    core.evaluateMotivations();
    assert.equal(core.getLastMotivationReasoningClass(), INSTINCTUAL, "none → instinctual");
  });

  // ── Regression: attacking:melee:+3 + reflexive:+1 ──

  test("attacking:+3 + reflexive:+1 resolves canMove=true and aggroRangeBoost=true", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const CAN_MOVE = 1, AGGRO_RANGE = 8;

    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(5, 3, 1, 0); // attacking, intensity=3, pattern=melee=1
    core.addMotivationEvaluationEntry(9, 1, 0, 0); // reflexive, intensity=1
    core.evaluateMotivations();

    const flags = core.getLastMotivationFlags();
    assert.ok(flags & CAN_MOVE, "canMove is set");
    assert.ok(flags & AGGRO_RANGE, "aggroRangeBoost is set from attacking default flags");

    // Profile axes: attacking has higher axes than reflexive
    // attacking: exploring(1)/attacking(1)/goal_oriented(2)
    // reflexive: stationary(0)/none(0)/reflexive(1)
    // Max: exploring(1)/attacking(1)/goal_oriented(2)
    assert.equal(core.getLastMotivationMobilityTier(), 1, "mobility = exploring");
    assert.equal(core.getLastMotivationCombatTier(), 1, "combat = attacking");
    assert.equal(core.getLastMotivationCognitionTier(), 2, "cognition = goal_oriented");

    // Reasoning: goal_oriented → tactical
    assert.equal(core.getLastMotivationReasoningClass(), 1, "reasoning = tactical");
  });

  // ── Flag OR across motivations ──

  test("flags OR across motivations: stealthy + defending → prefersStealth + prefersCover", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const PREFERS_STEALTH = 2, PREFERS_COVER = 4;

    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(7, 1, 0, 0); // stealthy: prefersStealth
    core.addMotivationEvaluationEntry(6, 1, 1, 0); // defending: prefersCover
    core.evaluateMotivations();

    const flags = core.getLastMotivationFlags();
    assert.ok(flags & PREFERS_STEALTH, "prefersStealth from stealthy");
    assert.ok(flags & PREFERS_COVER, "prefersCover from defending");
  });

  // ── Explicit flagMask overrides ──

  test("explicit flagMask adds to default flags", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const AGGRO_RANGE = 8;

    // reflexive has no aggroRangeBoost by default, but pass it explicitly
    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(9, 1, 0, AGGRO_RANGE);
    core.evaluateMotivations();

    const flags = core.getLastMotivationFlags();
    assert.ok(flags & AGGRO_RANGE, "explicit aggroRangeBoost");
  });

  // ── Invalid kind rejected ──

  test("addMotivationEvaluationEntry rejects invalid kind", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationEvaluation();
    assert.equal(core.addMotivationEvaluationEntry(0, 1, 0, 0), 0, "kind 0");
    assert.equal(core.addMotivationEvaluationEntry(13, 1, 0, 0), 0, "kind 13");
    assert.equal(core.evaluateMotivations(), 0, "no entries");
  });

  // ── Reset clears evaluation ──

  test("resetMotivationEvaluation clears previous state", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationEvaluation();
    core.addMotivationEvaluationEntry(5, 3, 1, 0); // attacking
    core.evaluateMotivations();
    assert.ok(core.getLastMotivationFlags() > 0);

    core.resetMotivationEvaluation();
    assert.equal(core.getLastMotivationFlags(), 0, "flags cleared");
    assert.equal(core.getLastMotivationMobilityTier(), 0, "mobility cleared");
    assert.equal(core.getLastMotivationCombatTier(), 0, "combat cleared");
    assert.equal(core.getLastMotivationCognitionTier(), 0, "cognition cleared");
    assert.equal(core.getLastMotivationReasoningClass(), 0, "reasoning cleared");
  });
}

// ## TODO: Test Permutations
// - [ ] Profile axis parity: all 12 kinds × verify mobility/combat/cognition match JS artifact
// - [ ] Profile cost parity: all 12 kinds match profileCosts sum from JS globals
// - [ ] Design cost parity: all 12 kinds match defaultDesignCostTokens from JS artifact
// - [ ] Flag mask parity: all 12 kinds match defaultFlags from JS artifact
// - [ ] Reasoning class: all 4 cognition tiers (none, reflexive, goal_oriented, strategy_focused) → correct class
// - [ ] Evaluation with all 12 kinds: add all 12, verify max axes across all
// - [ ] Evaluation overflow: 13th entry rejected
// - [ ] Flag combinations: every pair of flag-bearing kinds produces correct OR'd mask
// - [ ] Mixed stack: 3+ motivations from different families, verify axes and flags
