// Motivation codebook — deterministic constants and lookup helpers.
// Ported from packages/core-ts/src/state/motivation.ts.
// No IO, no imports outside core-ts. All codes are number-safe.

// ── Motivation Kind (1-based, matching runtime MOTIVATION_KINDS order) ──

export const MotivationKind = {
  Random: 1,
  Stationary: 2,
  Exploring: 3,
  Patrolling: 4,
  Attacking: 5,
  Defending: 6,
  Stealthy: 7,
  Friendly: 8,
  Reflexive: 9,
  GoalOriented: 10,
  StrategyFocused: 11,
  UserControlled: 12,
} as const;

const MOTIVATION_KIND_COUNT = 12;
const MOTIVATION_KIND_MIN = 1;
const MOTIVATION_KIND_MAX = 12;

export function getMotivationKindCount(): number {
  return MOTIVATION_KIND_COUNT;
}

export function isValidMotivationKind(kind: number): boolean {
  return kind >= MOTIVATION_KIND_MIN && kind <= MOTIVATION_KIND_MAX;
}

// ── Motivation Family (0-based) ──

export const MotivationFamily = {
  Mobility: 0,
  Posture: 1,
  Cognition: 2,
  Control: 3,
} as const;

const MOTIVATION_FAMILY_COUNT = 4;

export function getMotivationFamilyCount(): number {
  return MOTIVATION_FAMILY_COUNT;
}

// ── Family membership lookup ──
// Indexed by kind code (1-based). Index 0 is sentinel (-1).

const FAMILY_TABLE: readonly number[] = Object.freeze([
  -1,                        // 0: sentinel
  MotivationFamily.Mobility, // 1: Random
  MotivationFamily.Mobility, // 2: Stationary
  MotivationFamily.Mobility, // 3: Exploring
  MotivationFamily.Mobility, // 4: Patrolling
  MotivationFamily.Posture,  // 5: Attacking
  MotivationFamily.Posture,  // 6: Defending
  MotivationFamily.Posture,  // 7: Stealthy
  MotivationFamily.Posture,  // 8: Friendly
  MotivationFamily.Cognition,// 9: Reflexive
  MotivationFamily.Cognition,// 10: GoalOriented
  MotivationFamily.Cognition,// 11: StrategyFocused
  MotivationFamily.Control,  // 12: UserControlled
]);

export function getMotivationFamily(kind: number): number {
  if (!isValidMotivationKind(kind)) return -1;
  return FAMILY_TABLE[kind];
}

// ── Exclusive group lookup ──
// mobility=0, posture=1, cognition=2. control has no exclusive group (-1).

export function getMotivationExclusiveGroup(kind: number): number {
  const family = getMotivationFamily(kind);
  if (family < 0) return -1;
  if (family === MotivationFamily.Control) return -1;
  return family;
}

// ── Conflict detection ──

export function motivationKindsConflict(
  leftKind: number,
  rightKind: number,
): boolean {
  if (!isValidMotivationKind(leftKind) || !isValidMotivationKind(rightKind))
    return false;
  if (leftKind === rightKind) return false;
  const leftGroup = getMotivationExclusiveGroup(leftKind);
  const rightGroup = getMotivationExclusiveGroup(rightKind);
  if (leftGroup < 0 || rightGroup < 0) return false;
  return leftGroup === rightGroup;
}

// ── Pattern metadata ──

const PATROLLING_PATTERN_COUNT = 3;
const ATTACKING_PATTERN_COUNT = 3;
const DEFENDING_PATTERN_COUNT = 2;

export function getMotivationPatternCount(kind: number): number {
  if (kind === MotivationKind.Patrolling) return PATROLLING_PATTERN_COUNT;
  if (kind === MotivationKind.Attacking) return ATTACKING_PATTERN_COUNT;
  if (kind === MotivationKind.Defending) return DEFENDING_PATTERN_COUNT;
  return 0;
}

export function getMotivationPatternCodeAt(
  kind: number,
  index: number,
): number {
  const count = getMotivationPatternCount(kind);
  if (count === 0 || index < 0 || index >= count) return 0;
  return index + 1;
}

export function getDefaultMotivationPattern(kind: number): number {
  if (getMotivationPatternCount(kind) === 0) return 0;
  return 1;
}

// ══════════════════════════════════════════════════════════════════════════════
// §2 Motivation tier classification and default costs
// ══════════════════════════════════════════════════════════════════════════════

export const MotivationTier = {
  Simple: 0,
  Advanced: 1,
  Control: 2,
} as const;

const SIMPLE_COST = 25;
const ADVANCED_COST = 50;
const CONTROL_COST = 10;

// Indexed by kind code (1-based). Index 0 is sentinel.
const TIER_TABLE: readonly number[] = Object.freeze([
  -1,                          // 0: sentinel
  MotivationTier.Simple,       // 1: Random
  MotivationTier.Simple,       // 2: Stationary
  MotivationTier.Simple,       // 3: Exploring
  MotivationTier.Simple,       // 4: Patrolling
  MotivationTier.Simple,       // 5: Attacking
  MotivationTier.Simple,       // 6: Defending
  MotivationTier.Advanced,     // 7: Stealthy
  MotivationTier.Simple,       // 8: Friendly
  MotivationTier.Simple,       // 9: Reflexive
  MotivationTier.Advanced,     // 10: GoalOriented
  MotivationTier.Advanced,     // 11: StrategyFocused
  MotivationTier.Control,      // 12: UserControlled
]);

function deriveCost(tier: number): number {
  if (tier === MotivationTier.Simple) return SIMPLE_COST;
  if (tier === MotivationTier.Advanced) return ADVANCED_COST;
  if (tier === MotivationTier.Control) return CONTROL_COST;
  return 0;
}

const COST_TABLE: readonly number[] = Object.freeze(
  TIER_TABLE.map((tier) => (tier < 0 ? 0 : deriveCost(tier))),
);

// ── Intensity normalization ──

const INTENSITY_MIN = 1;
const INTENSITY_MAX = 10;

export function normalizeMotivationIntensity(raw: number): number {
  if (raw < INTENSITY_MIN) return INTENSITY_MIN;
  if (raw > INTENSITY_MAX) return INTENSITY_MAX;
  return raw;
}

// ── Tier and default cost lookups ──

export function getMotivationTier(kind: number): number {
  if (!isValidMotivationKind(kind)) return -1;
  return TIER_TABLE[kind];
}

export function getMotivationDefaultUnitCost(kind: number): number {
  if (!isValidMotivationKind(kind)) return 0;
  return COST_TABLE[kind];
}

// ══════════════════════════════════════════════════════════════════════════════
// §4 Profile axes, reasoning class, behavior flags
// ══════════════════════════════════════════════════════════════════════════════

export const ReasoningClass = {
  Instinctual: 0,
  Tactical: 1,
  Strategic: 2,
} as const;

export const MotivationFlag = {
  CanMove: 1,
  PrefersStealth: 2,
  PrefersCover: 4,
  AggroRangeBoost: 8,
} as const;

const FLAG_COUNT = 4;

export function getMotivationFlagCount(): number {
  return FLAG_COUNT;
}

// ── Per-kind profile axes (1-based index, 0 is sentinel) ──

// mobility: stationary=0, exploring=1, patrolling=2
const PROFILE_MOBILITY: readonly number[] = Object.freeze([
  -1, // 0: sentinel
  1,  // 1: Random → exploring
  0,  // 2: Stationary → stationary
  1,  // 3: Exploring → exploring
  2,  // 4: Patrolling → patrolling
  1,  // 5: Attacking → exploring
  0,  // 6: Defending → stationary
  1,  // 7: Stealthy → exploring
  1,  // 8: Friendly → exploring
  0,  // 9: Reflexive → stationary
  0,  // 10: GoalOriented → stationary
  0,  // 11: StrategyFocused → stationary
  0,  // 12: UserControlled → stationary
]);

// combat: none=0, attacking=1, defending=2
const PROFILE_COMBAT: readonly number[] = Object.freeze([
  -1, // 0: sentinel
  0,  // 1: Random
  0,  // 2: Stationary
  0,  // 3: Exploring
  0,  // 4: Patrolling
  1,  // 5: Attacking
  2,  // 6: Defending
  0,  // 7: Stealthy
  0,  // 8: Friendly
  0,  // 9: Reflexive
  0,  // 10: GoalOriented
  0,  // 11: StrategyFocused
  0,  // 12: UserControlled
]);

// cognition: none=0, reflexive=1, goal_oriented=2, strategy_focused=3
const PROFILE_COGNITION: readonly number[] = Object.freeze([
  -1, // 0: sentinel
  1,  // 1: Random → reflexive
  0,  // 2: Stationary → none
  1,  // 3: Exploring → reflexive
  1,  // 4: Patrolling → reflexive
  2,  // 5: Attacking → goal_oriented
  2,  // 6: Defending → goal_oriented
  2,  // 7: Stealthy → goal_oriented
  1,  // 8: Friendly → reflexive
  1,  // 9: Reflexive → reflexive
  2,  // 10: GoalOriented → goal_oriented
  3,  // 11: StrategyFocused → strategy_focused
  0,  // 12: UserControlled → none
]);

const DEFAULT_FLAG_MASK: readonly number[] = Object.freeze([
  0,                                                           // 0: sentinel
  MotivationFlag.CanMove,                                      // 1: Random
  MotivationFlag.CanMove,                                      // 2: Stationary
  MotivationFlag.CanMove,                                      // 3: Exploring
  MotivationFlag.CanMove,                                      // 4: Patrolling
  MotivationFlag.CanMove | MotivationFlag.AggroRangeBoost,     // 5: Attacking
  MotivationFlag.CanMove | MotivationFlag.PrefersCover,        // 6: Defending
  MotivationFlag.CanMove | MotivationFlag.PrefersStealth,      // 7: Stealthy
  MotivationFlag.CanMove,                                      // 8: Friendly
  MotivationFlag.CanMove,                                      // 9: Reflexive
  MotivationFlag.CanMove,                                      // 10: GoalOriented
  MotivationFlag.CanMove,                                      // 11: StrategyFocused
  MotivationFlag.CanMove,                                      // 12: UserControlled
]);

const DEFAULT_DESIGN_COST: readonly number[] = Object.freeze([
  0,  // 0: sentinel
  0,  // 1: Random
  0,  // 2: Stationary
  0,  // 3: Exploring
  0,  // 4: Patrolling
  0,  // 5: Attacking
  0,  // 6: Defending
  0,  // 7: Stealthy
  0,  // 8: Friendly
  1,  // 9: Reflexive
  5,  // 10: GoalOriented
  20, // 11: StrategyFocused
  0,  // 12: UserControlled
]);

// ── Profile cost lookup ──
// mobility: stationary=0, exploring=1, patrolling=2
// combat: none=0, attacking=5, defending=4
// cognition: none=0, reflexive=1, goal_oriented=5, strategy_focused=20

const MOBILITY_COST: readonly number[] = Object.freeze([0, 1, 2]);
const COMBAT_COST: readonly number[] = Object.freeze([0, 5, 4]);
const COGNITION_COST: readonly number[] = Object.freeze([0, 1, 5, 20]);

export function getMotivationProfileCost(kind: number): number {
  if (!isValidMotivationKind(kind)) return -1;
  const mob = PROFILE_MOBILITY[kind];
  const com = PROFILE_COMBAT[kind];
  const cog = PROFILE_COGNITION[kind];
  return MOBILITY_COST[mob] + COMBAT_COST[com] + COGNITION_COST[cog];
}

export function getMotivationDefaultDesignCost(kind: number): number {
  if (!isValidMotivationKind(kind)) return 0;
  return DEFAULT_DESIGN_COST[kind];
}

export function getMotivationDefaultFlagMask(kind: number): number {
  if (!isValidMotivationKind(kind)) return 0;
  return DEFAULT_FLAG_MASK[kind];
}

// ── Reasoning class derivation from cognition tier ──

function reasoningClassFromCognition(cognition: number): number {
  if (cognition === 3) return ReasoningClass.Strategic;
  if (cognition === 2) return ReasoningClass.Tactical;
  return ReasoningClass.Instinctual;
}

// ══════════════════════════════════════════════════════════════════════════════
// §3 & §5 Closure-based state: cost accumulator + evaluation accumulator
// Created per createCore() instance via createMotivationState()
// ══════════════════════════════════════════════════════════════════════════════

const MAX_COST_LINES = 12;
const MAX_EVAL_ENTRIES = 12;

export function createMotivationState() {
  // ── Cost accumulator ──
  let costLineCount = 0;
  let costTotal = 0;
  const costLineKinds = new Int32Array(MAX_COST_LINES);
  const costLineFamilies = new Int32Array(MAX_COST_LINES).fill(-1);
  const costLineQuantities = new Int32Array(MAX_COST_LINES);
  const costLineUnitCosts = new Int32Array(MAX_COST_LINES);
  const costLineSpends = new Int32Array(MAX_COST_LINES);

  function resetMotivationCostAccumulator(): number {
    costLineCount = 0;
    costTotal = 0;
    for (let i = 0; i < MAX_COST_LINES; i++) {
      costLineKinds[i] = 0;
      costLineFamilies[i] = -1;
      costLineQuantities[i] = 0;
      costLineUnitCosts[i] = 0;
      costLineSpends[i] = 0;
    }
    return 1;
  }

  function addMotivationCostEntry(kind: number, rawIntensity: number): number {
    if (!isValidMotivationKind(kind)) return 0;
    if (costLineCount >= MAX_COST_LINES) return 0;

    const intensity = normalizeMotivationIntensity(rawIntensity);
    const unitCost = getMotivationDefaultUnitCost(kind);
    const spend = unitCost * intensity;
    const family = getMotivationFamily(kind);

    const idx = costLineCount;
    costLineKinds[idx] = kind;
    costLineFamilies[idx] = family;
    costLineQuantities[idx] = intensity;
    costLineUnitCosts[idx] = unitCost;
    costLineSpends[idx] = spend;

    costLineCount += 1;
    costTotal += spend;
    return 1;
  }

  // ── Evaluation accumulator ──
  let evalEntryCount = 0;
  let evalMobilityTier = 0;
  let evalCombatTier = 0;
  let evalCognitionTier = 0;
  let evalFlagMask = 0;
  let evalReasoningClass = 0;

  function resetMotivationEvaluation(): number {
    evalEntryCount = 0;
    evalMobilityTier = 0;
    evalCombatTier = 0;
    evalCognitionTier = 0;
    evalFlagMask = 0;
    evalReasoningClass = 0;
    return 1;
  }

  function addMotivationEvaluationEntry(
    kind: number,
    _intensity: number,
    _pattern: number,
    flagMask: number,
  ): number {
    if (!isValidMotivationKind(kind)) return 0;
    if (evalEntryCount >= MAX_EVAL_ENTRIES) return 0;

    evalEntryCount += 1;

    const mob = PROFILE_MOBILITY[kind];
    const com = PROFILE_COMBAT[kind];
    const cog = PROFILE_COGNITION[kind];
    if (mob > evalMobilityTier) evalMobilityTier = mob;
    if (com > evalCombatTier) evalCombatTier = com;
    if (cog > evalCognitionTier) evalCognitionTier = cog;

    const defaultMask = DEFAULT_FLAG_MASK[kind];
    evalFlagMask = evalFlagMask | defaultMask | flagMask;

    return 1;
  }

  function evaluateMotivations(): number {
    evalReasoningClass = reasoningClassFromCognition(evalCognitionTier);
    return evalEntryCount;
  }

  return {
    // Cost accumulator
    resetMotivationCostAccumulator,
    addMotivationCostEntry,
    getMotivationCostTotal: () => costTotal,
    getMotivationCostLineCount: () => costLineCount,
    getMotivationCostLineKind: (index: number) =>
      index < 0 || index >= costLineCount ? 0 : costLineKinds[index],
    getMotivationCostLineFamily: (index: number) =>
      index < 0 || index >= costLineCount ? -1 : costLineFamilies[index],
    getMotivationCostLineQuantity: (index: number) =>
      index < 0 || index >= costLineCount ? 0 : costLineQuantities[index],
    getMotivationCostLineUnitCost: (index: number) =>
      index < 0 || index >= costLineCount ? 0 : costLineUnitCosts[index],
    getMotivationCostLineSpend: (index: number) =>
      index < 0 || index >= costLineCount ? 0 : costLineSpends[index],
    // Evaluation accumulator
    resetMotivationEvaluation,
    addMotivationEvaluationEntry,
    evaluateMotivations,
    getLastMotivationFlags: () => evalFlagMask,
    getLastMotivationMobilityTier: () => evalMobilityTier,
    getLastMotivationCombatTier: () => evalCombatTier,
    getLastMotivationCognitionTier: () => evalCognitionTier,
    getLastMotivationReasoningClass: () => evalReasoningClass,
  };
}
