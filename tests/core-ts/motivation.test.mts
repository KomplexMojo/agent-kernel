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

describe("core-ts motivation permutations", () => {
  test("all 12 motivation kinds map to the correct family", () => {
    const familyMap: Array<[number, number]> = [
      [MotivationKind.Random, MotivationFamily.Mobility],
      [MotivationKind.Stationary, MotivationFamily.Mobility],
      [MotivationKind.Exploring, MotivationFamily.Mobility],
      [MotivationKind.Patrolling, MotivationFamily.Mobility],
      [MotivationKind.Attacking, MotivationFamily.Posture],
      [MotivationKind.Defending, MotivationFamily.Posture],
      [MotivationKind.Stealthy, MotivationFamily.Posture],
      [MotivationKind.Friendly, MotivationFamily.Posture],
      [MotivationKind.Reflexive, MotivationFamily.Cognition],
      [MotivationKind.GoalOriented, MotivationFamily.Cognition],
      [MotivationKind.StrategyFocused, MotivationFamily.Cognition],
      [MotivationKind.UserControlled, MotivationFamily.Control],
    ];
    for (const [kind, family] of familyMap) {
      expect(getMotivationFamily(kind)).toBe(family);
    }
  });

  test("exclusive group conflict matrix: same-group pairs conflict, cross-group do not", () => {
    // Mobility group: Random, Exploring, Patrolling (group 0)
    expect(motivationKindsConflict(MotivationKind.Random, MotivationKind.Exploring)).toBe(true);
    expect(motivationKindsConflict(MotivationKind.Random, MotivationKind.Patrolling)).toBe(true);
    expect(motivationKindsConflict(MotivationKind.Exploring, MotivationKind.Patrolling)).toBe(true);

    // Posture group: Attacking, Defending, Stealthy (group 1)
    expect(motivationKindsConflict(MotivationKind.Attacking, MotivationKind.Defending)).toBe(true);
    expect(motivationKindsConflict(MotivationKind.Attacking, MotivationKind.Stealthy)).toBe(true);
    expect(motivationKindsConflict(MotivationKind.Defending, MotivationKind.Stealthy)).toBe(true);

    // Cognition group: Reflexive, GoalOriented, StrategyFocused (group 2)
    expect(motivationKindsConflict(MotivationKind.Reflexive, MotivationKind.GoalOriented)).toBe(true);
    expect(motivationKindsConflict(MotivationKind.Reflexive, MotivationKind.StrategyFocused)).toBe(true);
    expect(motivationKindsConflict(MotivationKind.GoalOriented, MotivationKind.StrategyFocused)).toBe(true);

    // Cross-group: no conflict
    expect(motivationKindsConflict(MotivationKind.Random, MotivationKind.Attacking)).toBe(false);
    expect(motivationKindsConflict(MotivationKind.Exploring, MotivationKind.Reflexive)).toBe(false);
    expect(motivationKindsConflict(MotivationKind.Defending, MotivationKind.GoalOriented)).toBe(false);

    // Control group has exclusive group -1 (no conflicts)
    expect(motivationKindsConflict(MotivationKind.UserControlled, MotivationKind.Random)).toBe(false);
  });

  test("cost accumulator rejects invalid kinds (0 and 13)", () => {
    const core = createCore();
    call(core.resetMotivationCostAccumulator);
    // Kind 0 is invalid
    call(core.addMotivationCostEntry, 0, 5);
    expect(call(core.getMotivationCostLineCount)).toBe(0);
  });

  test("cost accumulator reset clears all line items and total", () => {
    const core = createCore();
    call(core.resetMotivationCostAccumulator);
    call(core.addMotivationCostEntry, MotivationKind.Random, 5);
    call(core.addMotivationCostEntry, MotivationKind.Stealthy, 3);
    expect(call(core.getMotivationCostLineCount)).toBe(2);
    expect(call(core.getMotivationCostTotal)).toBeGreaterThan(0);

    call(core.resetMotivationCostAccumulator);
    expect(call(core.getMotivationCostLineCount)).toBe(0);
    expect(call(core.getMotivationCostTotal)).toBe(0);
  });

  test("reasoning class derivation for all cognition tiers", () => {
    // cognition 0 → Instinctual (via Stationary which has cognition=0)
    const core0 = createCore();
    call(core0.resetMotivationEvaluation);
    call(core0.addMotivationEvaluationEntry, MotivationKind.Stationary, 5, 0, 0);
    call(core0.evaluateMotivations);
    expect(call(core0.getLastMotivationReasoningClass)).toBe(ReasoningClass.Instinctual);

    // cognition 1 → Instinctual (via Random which has cognition=1, still maps to Instinctual)
    const core1 = createCore();
    call(core1.resetMotivationEvaluation);
    call(core1.addMotivationEvaluationEntry, MotivationKind.Random, 5, 0, 0);
    call(core1.evaluateMotivations);
    expect(call(core1.getLastMotivationReasoningClass)).toBe(ReasoningClass.Instinctual);

    // cognition 2 → Tactical (via Attacking which has cognition=2)
    const core2 = createCore();
    call(core2.resetMotivationEvaluation);
    call(core2.addMotivationEvaluationEntry, MotivationKind.Attacking, 5, 1, 0);
    call(core2.evaluateMotivations);
    expect(call(core2.getLastMotivationReasoningClass)).toBe(ReasoningClass.Tactical);

    // cognition 3 → Strategic (via StrategyFocused)
    const core3 = createCore();
    call(core3.resetMotivationEvaluation);
    call(core3.addMotivationEvaluationEntry, MotivationKind.StrategyFocused, 5, 0, 0);
    call(core3.evaluateMotivations);
    expect(call(core3.getLastMotivationReasoningClass)).toBe(ReasoningClass.Strategic);
  });
});
