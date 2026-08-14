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
  normalizeMotivationIntensity,
  getMotivationDefaultFlagMask,
  getMotivationFlagCount,
} from "../../packages/core-ts/src/state/motivation.ts";

// Core's motivation COST surface (unit/profile/design costs, the cost
// accumulator) was deleted in P1.2 — pricing is Allocator policy, not core.
// Its tests went with it; transferable coverage (validity guard, reset,
// instance isolation) moved onto the evaluation accumulator below.

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

  test("tier classification", () => {
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
  });

  test("intensity normalization clamps", () => {
    expect(normalizeMotivationIntensity(0)).toBe(1);
    expect(normalizeMotivationIntensity(5)).toBe(5);
    expect(normalizeMotivationIntensity(15)).toBe(10);
  });

  test("flag masks", () => {
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

describe("core-ts motivation state (evaluation accumulator)", () => {
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

    call(a.resetMotivationEvaluation);
    call(a.addMotivationEvaluationEntry, MotivationKind.Attacking, 5, 1, 0);
    call(a.evaluateMotivations);

    call(b.resetMotivationEvaluation);
    call(b.evaluateMotivations);

    expect(call(a.getLastMotivationCombatTier)).toBe(1);
    expect(call(b.getLastMotivationCombatTier)).toBe(0);
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

  test("evaluation accumulator rejects invalid kinds (0 and 13)", () => {
    const core = createCore();
    call(core.resetMotivationEvaluation);
    call(core.addMotivationEvaluationEntry, 0, 5, 0, 0);
    call(core.addMotivationEvaluationEntry, 13, 5, 0, 0);
    expect(call(core.evaluateMotivations)).toBe(0);
  });

  test("evaluation reset clears tiers and flags", () => {
    const core = createCore();
    call(core.resetMotivationEvaluation);
    call(core.addMotivationEvaluationEntry, MotivationKind.Stealthy, 3, 0, 0);
    call(core.evaluateMotivations);
    expect(call(core.getLastMotivationFlags)).not.toBe(0);

    call(core.resetMotivationEvaluation);
    expect(call(core.getLastMotivationFlags)).toBe(0);
    expect(call(core.getLastMotivationCognitionTier)).toBe(0);
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
