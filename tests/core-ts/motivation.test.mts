import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  MotivationKind,
  MotivationFamily,
  MotivationTier,
  MotivationFlag,
  ReasoningClass,
  getMotivationKindCount,
  getMotivationFamily,
  getMotivationExclusiveGroup,
  motivationKindsConflict,
  getMotivationPatternCount,
  getMotivationPatternCodeAt,
  getDefaultMotivationPattern,
  getMotivationTier,
  getMotivationDefaultUnitCost,
  normalizeMotivationIntensity,
  getMotivationProfileCost,
  getMotivationDefaultDesignCost,
  getMotivationDefaultFlagMask,
  getMotivationFlagCount,
} from "../../packages/core-ts/src/state/motivation.ts";

describe("core-ts motivation codebook", () => {
  test("getMotivationKindCount returns 12", () => {
    expect(getMotivationKindCount()).toBe(12);
  });

  test("family lookups match expected families", () => {
    expect(getMotivationFamily(MotivationKind.Random)).toBe(
      MotivationFamily.Mobility,
    );
    expect(getMotivationFamily(MotivationKind.Patrolling)).toBe(
      MotivationFamily.Mobility,
    );
    expect(getMotivationFamily(MotivationKind.Attacking)).toBe(
      MotivationFamily.Posture,
    );
    expect(getMotivationFamily(MotivationKind.Stealthy)).toBe(
      MotivationFamily.Posture,
    );
    expect(getMotivationFamily(MotivationKind.Reflexive)).toBe(
      MotivationFamily.Cognition,
    );
    expect(getMotivationFamily(MotivationKind.StrategyFocused)).toBe(
      MotivationFamily.Cognition,
    );
    expect(getMotivationFamily(MotivationKind.UserControlled)).toBe(
      MotivationFamily.Control,
    );
    expect(getMotivationFamily(0)).toBe(-1);
    expect(getMotivationFamily(13)).toBe(-1);
  });

  test("exclusive group and conflict detection", () => {
    expect(getMotivationExclusiveGroup(MotivationKind.Random)).toBe(0);
    expect(getMotivationExclusiveGroup(MotivationKind.Attacking)).toBe(1);
    expect(getMotivationExclusiveGroup(MotivationKind.Reflexive)).toBe(2);
    expect(getMotivationExclusiveGroup(MotivationKind.UserControlled)).toBe(-1);

    expect(
      motivationKindsConflict(MotivationKind.Random, MotivationKind.Exploring),
    ).toBe(true);
    expect(
      motivationKindsConflict(
        MotivationKind.Attacking,
        MotivationKind.Defending,
      ),
    ).toBe(true);
    expect(
      motivationKindsConflict(MotivationKind.Random, MotivationKind.Attacking),
    ).toBe(false);
    expect(
      motivationKindsConflict(MotivationKind.Random, MotivationKind.Random),
    ).toBe(false);
    expect(
      motivationKindsConflict(
        MotivationKind.UserControlled,
        MotivationKind.Random,
      ),
    ).toBe(false);
  });

  test("pattern metadata", () => {
    expect(getMotivationPatternCount(MotivationKind.Patrolling)).toBe(3);
    expect(getMotivationPatternCount(MotivationKind.Attacking)).toBe(3);
    expect(getMotivationPatternCount(MotivationKind.Defending)).toBe(2);
    expect(getMotivationPatternCount(MotivationKind.Random)).toBe(0);

    expect(getMotivationPatternCodeAt(MotivationKind.Patrolling, 0)).toBe(1);
    expect(getMotivationPatternCodeAt(MotivationKind.Patrolling, 2)).toBe(3);
    expect(getMotivationPatternCodeAt(MotivationKind.Patrolling, 3)).toBe(0);

    expect(getDefaultMotivationPattern(MotivationKind.Patrolling)).toBe(1);
    expect(getDefaultMotivationPattern(MotivationKind.Random)).toBe(0);
  });

  test("tier and default costs", () => {
    expect(getMotivationTier(MotivationKind.Random)).toBe(
      MotivationTier.Simple,
    );
    expect(getMotivationTier(MotivationKind.Stealthy)).toBe(
      MotivationTier.Advanced,
    );
    expect(getMotivationTier(MotivationKind.UserControlled)).toBe(
      MotivationTier.Control,
    );
    expect(getMotivationTier(0)).toBe(-1);

    expect(getMotivationDefaultUnitCost(MotivationKind.Random)).toBe(25);
    expect(getMotivationDefaultUnitCost(MotivationKind.Stealthy)).toBe(50);
    expect(getMotivationDefaultUnitCost(MotivationKind.UserControlled)).toBe(10);
  });

  test("intensity normalization clamps", () => {
    expect(normalizeMotivationIntensity(0)).toBe(1);
    expect(normalizeMotivationIntensity(5)).toBe(5);
    expect(normalizeMotivationIntensity(15)).toBe(10);
  });

  test("profile cost sums mobility + combat + cognition axes", () => {
    // Random: exploring=1 + none=0 + reflexive=1 = 2
    expect(getMotivationProfileCost(MotivationKind.Random)).toBe(2);
    // Attacking: exploring=1 + attacking=5 + goal_oriented=5 = 11
    expect(getMotivationProfileCost(MotivationKind.Attacking)).toBe(11);
    // StrategyFocused: stationary=0 + none=0 + strategy_focused=20 = 20
    expect(getMotivationProfileCost(MotivationKind.StrategyFocused)).toBe(20);
  });

  test("design costs and flag masks", () => {
    expect(getMotivationDefaultDesignCost(MotivationKind.Reflexive)).toBe(1);
    expect(getMotivationDefaultDesignCost(MotivationKind.GoalOriented)).toBe(5);
    expect(getMotivationDefaultDesignCost(MotivationKind.StrategyFocused)).toBe(20);
    expect(getMotivationDefaultDesignCost(MotivationKind.Random)).toBe(0);

    expect(getMotivationDefaultFlagMask(MotivationKind.Attacking)).toBe(
      MotivationFlag.CanMove | MotivationFlag.AggroRangeBoost,
    );
    expect(getMotivationDefaultFlagMask(MotivationKind.Stealthy)).toBe(
      MotivationFlag.CanMove | MotivationFlag.PrefersStealth,
    );
    expect(getMotivationDefaultFlagMask(MotivationKind.Defending)).toBe(
      MotivationFlag.CanMove | MotivationFlag.PrefersCover,
    );
    expect(getMotivationFlagCount()).toBe(4);
  });
});

describe("core-ts motivation state (cost + evaluation accumulators)", () => {
  test("cost accumulator stores and retrieves line items", () => {
    const core = createCore();

    call(core.resetMotivationCostAccumulator);
    call(core.addMotivationCostEntry, MotivationKind.Random, 5);
    call(core.addMotivationCostEntry, MotivationKind.Stealthy, 3);

    expect(call(core.getMotivationCostLineCount)).toBe(2);
    expect(call(core.getMotivationCostLineKind, 0)).toBe(MotivationKind.Random);
    expect(call(core.getMotivationCostLineFamily, 0)).toBe(
      MotivationFamily.Mobility,
    );
    expect(call(core.getMotivationCostLineQuantity, 0)).toBe(5);
    expect(call(core.getMotivationCostLineUnitCost, 0)).toBe(25);
    expect(call(core.getMotivationCostLineSpend, 0)).toBe(125);

    expect(call(core.getMotivationCostLineKind, 1)).toBe(
      MotivationKind.Stealthy,
    );
    expect(call(core.getMotivationCostLineSpend, 1)).toBe(150);

    expect(call(core.getMotivationCostTotal)).toBe(275);
  });

  test("cost accumulator clamps intensity", () => {
    const core = createCore();

    call(core.resetMotivationCostAccumulator);
    call(core.addMotivationCostEntry, MotivationKind.Random, 0);

    expect(call(core.getMotivationCostLineQuantity, 0)).toBe(1);
  });

  test("evaluation accumulator computes profile axes and flags", () => {
    const core = createCore();

    call(core.resetMotivationEvaluation);
    call(
      core.addMotivationEvaluationEntry,
      MotivationKind.Attacking,
      5,
      1,
      0,
    );
    call(
      core.addMotivationEvaluationEntry,
      MotivationKind.Stealthy,
      3,
      0,
      0,
    );
    const count = call(core.evaluateMotivations);

    expect(count).toBe(2);
    // max mobility: Attacking=exploring(1), Stealthy=exploring(1) → 1
    expect(call(core.getLastMotivationMobilityTier)).toBe(1);
    // max combat: Attacking=1, Stealthy=0 → 1
    expect(call(core.getLastMotivationCombatTier)).toBe(1);
    // max cognition: Attacking=goal_oriented(2), Stealthy=goal_oriented(2) → 2
    expect(call(core.getLastMotivationCognitionTier)).toBe(2);
    // reasoning: cognition 2 → Tactical
    expect(call(core.getLastMotivationReasoningClass)).toBe(
      ReasoningClass.Tactical,
    );
    // flags: OR of attacking(canMove|aggroRangeBoost) and stealthy(canMove|prefersStealth)
    expect(call(core.getLastMotivationFlags)).toBe(
      MotivationFlag.CanMove |
        MotivationFlag.AggroRangeBoost |
        MotivationFlag.PrefersStealth,
    );
  });

  test("evaluation with strategy_focused yields Strategic reasoning", () => {
    const core = createCore();

    call(core.resetMotivationEvaluation);
    call(
      core.addMotivationEvaluationEntry,
      MotivationKind.StrategyFocused,
      5,
      0,
      0,
    );
    call(core.evaluateMotivations);

    expect(call(core.getLastMotivationReasoningClass)).toBe(
      ReasoningClass.Strategic,
    );
  });

  test("separate createCore instances have independent state", () => {
    const a = createCore();
    const b = createCore();

    call(a.resetMotivationCostAccumulator);
    call(a.addMotivationCostEntry, MotivationKind.Random, 5);

    call(b.resetMotivationCostAccumulator);

    expect(call(a.getMotivationCostLineCount)).toBe(1);
    expect(call(b.getMotivationCostLineCount)).toBe(0);
  });
});

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

// ## TODO: Test Permutations
// - all 12 motivation kinds map to the correct family
// - exclusive group conflict matrix: all same-family pairs conflict, cross-family pairs do not
// - pattern codes for patrolling, attacking, defending with boundary indices
// - cost accumulator rejects invalid kinds and respects MAX_COST_LINES (12) cap
// - cost accumulator reset clears all line items and total
// - evaluation with all 12 kinds simultaneously to verify max-axis semantics
// - evaluation flag OR semantics with explicit flagMask parameter overrides
// - reasoning class derivation for all cognition tiers (0,1,2,3)
// - profile cost computation for all 12 kinds against known expected values
