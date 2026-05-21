// Motivation codebook — deterministic constants and lookup helpers.
// No IO, no imports outside core-as. All codes are i32-safe.

// ── Motivation Kind (1-based, matching runtime MOTIVATION_KINDS order) ──

export const enum MotivationKind {
  Random = 1,
  Stationary = 2,
  Exploring = 3,
  Patrolling = 4,
  Attacking = 5,
  Defending = 6,
  Stealthy = 7,
  Friendly = 8,
  Reflexive = 9,
  GoalOriented = 10,
  StrategyFocused = 11,
  UserControlled = 12,
}

const MOTIVATION_KIND_COUNT: i32 = 12;
const MOTIVATION_KIND_MIN: i32 = 1;
const MOTIVATION_KIND_MAX: i32 = 12;

export function getMotivationKindCount(): i32 {
  return MOTIVATION_KIND_COUNT;
}

export function isValidMotivationKind(kind: i32): bool {
  return kind >= MOTIVATION_KIND_MIN && kind <= MOTIVATION_KIND_MAX;
}

// ── Motivation Family (0-based) ──

export const enum MotivationFamily {
  Mobility = 0,
  Posture = 1,
  Cognition = 2,
  Control = 3,
}

const MOTIVATION_FAMILY_COUNT: i32 = 4;

export function getMotivationFamilyCount(): i32 {
  return MOTIVATION_FAMILY_COUNT;
}

// ── Family membership lookup ──

// Indexed by kind code (1-based). Index 0 is sentinel (-1).
const FAMILY_TABLE = new StaticArray<i32>(13);

function initFamilyTable(): void {
  unchecked(FAMILY_TABLE[0] = -1);
  // Mobility: random, stationary, exploring, patrolling
  unchecked(FAMILY_TABLE[MotivationKind.Random] = MotivationFamily.Mobility);
  unchecked(FAMILY_TABLE[MotivationKind.Stationary] = MotivationFamily.Mobility);
  unchecked(FAMILY_TABLE[MotivationKind.Exploring] = MotivationFamily.Mobility);
  unchecked(FAMILY_TABLE[MotivationKind.Patrolling] = MotivationFamily.Mobility);
  // Posture: attacking, defending, stealthy, friendly
  unchecked(FAMILY_TABLE[MotivationKind.Attacking] = MotivationFamily.Posture);
  unchecked(FAMILY_TABLE[MotivationKind.Defending] = MotivationFamily.Posture);
  unchecked(FAMILY_TABLE[MotivationKind.Stealthy] = MotivationFamily.Posture);
  unchecked(FAMILY_TABLE[MotivationKind.Friendly] = MotivationFamily.Posture);
  // Cognition: reflexive, goal_oriented, strategy_focused
  unchecked(FAMILY_TABLE[MotivationKind.Reflexive] = MotivationFamily.Cognition);
  unchecked(FAMILY_TABLE[MotivationKind.GoalOriented] = MotivationFamily.Cognition);
  unchecked(FAMILY_TABLE[MotivationKind.StrategyFocused] = MotivationFamily.Cognition);
  // Control: user_controlled
  unchecked(FAMILY_TABLE[MotivationKind.UserControlled] = MotivationFamily.Control);
}

let familyTableInitialized: bool = false;

function ensureFamilyTable(): void {
  if (!familyTableInitialized) {
    initFamilyTable();
    familyTableInitialized = true;
  }
}

export function getMotivationFamily(kind: i32): i32 {
  ensureFamilyTable();
  if (!isValidMotivationKind(kind)) return -1;
  return unchecked(FAMILY_TABLE[kind]);
}

// ── Exclusive group lookup ──
// mobility=0, posture=1, cognition=2. control has no exclusive group (-1).

export function getMotivationExclusiveGroup(kind: i32): i32 {
  const family = getMotivationFamily(kind);
  if (family < 0) return -1;
  // Only mobility, posture, and cognition are exclusive
  if (family == MotivationFamily.Control) return -1;
  return family; // mobility=0, posture=1, cognition=2
}

// ── Conflict detection ──

export function motivationKindsConflict(leftKind: i32, rightKind: i32): bool {
  if (!isValidMotivationKind(leftKind) || !isValidMotivationKind(rightKind)) return false;
  if (leftKind == rightKind) return false;
  const leftGroup = getMotivationExclusiveGroup(leftKind);
  const rightGroup = getMotivationExclusiveGroup(rightKind);
  if (leftGroup < 0 || rightGroup < 0) return false;
  return leftGroup == rightGroup;
}

// ── Pattern metadata ──

// Pattern codes are 1-based within each kind.
// patrolling: loop=1, ping_pong=2, random_walk=3
// attacking: melee=1, ranged=2, mixed=3
// defending: hold_point=1, bodyguard=2

const PATROLLING_PATTERN_COUNT: i32 = 3;
const ATTACKING_PATTERN_COUNT: i32 = 3;
const DEFENDING_PATTERN_COUNT: i32 = 2;

export function getMotivationPatternCount(kind: i32): i32 {
  if (kind == MotivationKind.Patrolling) return PATROLLING_PATTERN_COUNT;
  if (kind == MotivationKind.Attacking) return ATTACKING_PATTERN_COUNT;
  if (kind == MotivationKind.Defending) return DEFENDING_PATTERN_COUNT;
  return 0;
}

export function getMotivationPatternCodeAt(kind: i32, index: i32): i32 {
  const count = getMotivationPatternCount(kind);
  if (count == 0 || index < 0 || index >= count) return 0;
  // Pattern codes are 1-based sequential: index 0 -> code 1, index 1 -> code 2, etc.
  return index + 1;
}

export function getDefaultMotivationPattern(kind: i32): i32 {
  if (getMotivationPatternCount(kind) == 0) return 0;
  return 1; // First pattern code is always 1
}

// ══════════════════════════════════════════════════════════════════════════════
// §2 Motivation tier classification and default costs
// Matching runtime motivation-price-policy.js
// ══════════════════════════════════════════════════════════════════════════════

export const enum MotivationTier {
  Simple = 0,
  Advanced = 1,
  Control = 2,
}

const SIMPLE_COST: i32 = 25;
const ADVANCED_COST: i32 = 50;
const CONTROL_COST: i32 = 10;

// Indexed by kind code (1-based). Index 0 is sentinel.
const TIER_TABLE = new StaticArray<i32>(13);
const COST_TABLE = new StaticArray<i32>(13);

function initTierAndCostTables(): void {
  unchecked(TIER_TABLE[0] = -1);
  unchecked(COST_TABLE[0] = 0);

  // Mobility — all simple
  unchecked(TIER_TABLE[MotivationKind.Random] = MotivationTier.Simple);
  unchecked(TIER_TABLE[MotivationKind.Stationary] = MotivationTier.Simple);
  unchecked(TIER_TABLE[MotivationKind.Exploring] = MotivationTier.Simple);
  unchecked(TIER_TABLE[MotivationKind.Patrolling] = MotivationTier.Simple);

  // Posture — simple except stealthy (advanced)
  unchecked(TIER_TABLE[MotivationKind.Attacking] = MotivationTier.Simple);
  unchecked(TIER_TABLE[MotivationKind.Defending] = MotivationTier.Simple);
  unchecked(TIER_TABLE[MotivationKind.Stealthy] = MotivationTier.Advanced);
  unchecked(TIER_TABLE[MotivationKind.Friendly] = MotivationTier.Simple);

  // Cognition — reflexive is simple; goal_oriented and strategy_focused are advanced
  unchecked(TIER_TABLE[MotivationKind.Reflexive] = MotivationTier.Simple);
  unchecked(TIER_TABLE[MotivationKind.GoalOriented] = MotivationTier.Advanced);
  unchecked(TIER_TABLE[MotivationKind.StrategyFocused] = MotivationTier.Advanced);

  // Control
  unchecked(TIER_TABLE[MotivationKind.UserControlled] = MotivationTier.Control);

  // Default costs: simple=25, advanced=50, control=10
  for (let k: i32 = 1; k <= 12; k++) {
    const tier = unchecked(TIER_TABLE[k]);
    if (tier == MotivationTier.Simple) {
      unchecked(COST_TABLE[k] = SIMPLE_COST);
    } else if (tier == MotivationTier.Advanced) {
      unchecked(COST_TABLE[k] = ADVANCED_COST);
    } else if (tier == MotivationTier.Control) {
      unchecked(COST_TABLE[k] = CONTROL_COST);
    } else {
      unchecked(COST_TABLE[k] = 0);
    }
  }
}

let tierCostTablesInitialized: bool = false;

function ensureTierCostTables(): void {
  if (!tierCostTablesInitialized) {
    initTierAndCostTables();
    tierCostTablesInitialized = true;
  }
}

// ── Intensity normalization ──

const INTENSITY_MIN: i32 = 1;
const INTENSITY_MAX: i32 = 10;

export function normalizeMotivationIntensity(raw: i32): i32 {
  if (raw < INTENSITY_MIN) return INTENSITY_MIN;
  if (raw > INTENSITY_MAX) return INTENSITY_MAX;
  return raw;
}

// ── Tier and default cost lookups ──

export function getMotivationTier(kind: i32): i32 {
  ensureTierCostTables();
  if (!isValidMotivationKind(kind)) return -1;
  return unchecked(TIER_TABLE[kind]);
}

export function getMotivationDefaultUnitCost(kind: i32): i32 {
  ensureTierCostTables();
  if (!isValidMotivationKind(kind)) return 0;
  return unchecked(COST_TABLE[kind]);
}

// ══════════════════════════════════════════════════════════════════════════════
// §3 Motivation cost accumulator (last-result pattern)
// Stores line items so bindings can reconstruct JS cost shape.
// ══════════════════════════════════════════════════════════════════════════════

const MAX_COST_LINES: i32 = 12;

let costLineCount: i32 = 0;
let costTotal: i32 = 0;
let costLineKinds = new StaticArray<i32>(MAX_COST_LINES);
let costLineFamilies = new StaticArray<i32>(MAX_COST_LINES);
let costLineQuantities = new StaticArray<i32>(MAX_COST_LINES);
let costLineUnitCosts = new StaticArray<i32>(MAX_COST_LINES);
let costLineSpends = new StaticArray<i32>(MAX_COST_LINES);

export function resetMotivationCostAccumulator(): i32 {
  costLineCount = 0;
  costTotal = 0;
  for (let i: i32 = 0; i < MAX_COST_LINES; i++) {
    unchecked(costLineKinds[i] = 0);
    unchecked(costLineFamilies[i] = -1);
    unchecked(costLineQuantities[i] = 0);
    unchecked(costLineUnitCosts[i] = 0);
    unchecked(costLineSpends[i] = 0);
  }
  return 1;
}

export function addMotivationCostEntry(kind: i32, rawIntensity: i32): i32 {
  if (!isValidMotivationKind(kind)) return 0;
  if (costLineCount >= MAX_COST_LINES) return 0;

  const intensity = normalizeMotivationIntensity(rawIntensity);
  const unitCost = getMotivationDefaultUnitCost(kind);
  const spend = unitCost * intensity;
  const family = getMotivationFamily(kind);

  const idx = costLineCount;
  unchecked(costLineKinds[idx] = kind);
  unchecked(costLineFamilies[idx] = family);
  unchecked(costLineQuantities[idx] = intensity);
  unchecked(costLineUnitCosts[idx] = unitCost);
  unchecked(costLineSpends[idx] = spend);

  costLineCount += 1;
  costTotal += spend;
  return 1;
}

export function getMotivationCostTotal(): i32 {
  return costTotal;
}

export function getMotivationCostLineCount(): i32 {
  return costLineCount;
}

export function getMotivationCostLineKind(index: i32): i32 {
  if (index < 0 || index >= costLineCount) return 0;
  return unchecked(costLineKinds[index]);
}

export function getMotivationCostLineFamily(index: i32): i32 {
  if (index < 0 || index >= costLineCount) return -1;
  return unchecked(costLineFamilies[index]);
}

export function getMotivationCostLineQuantity(index: i32): i32 {
  if (index < 0 || index >= costLineCount) return 0;
  return unchecked(costLineQuantities[index]);
}

export function getMotivationCostLineUnitCost(index: i32): i32 {
  if (index < 0 || index >= costLineCount) return 0;
  return unchecked(costLineUnitCosts[index]);
}

export function getMotivationCostLineSpend(index: i32): i32 {
  if (index < 0 || index >= costLineCount) return 0;
  return unchecked(costLineSpends[index]);
}

// ══════════════════════════════════════════════════════════════════════════════
// §4 Profile axes, reasoning class, behavior flags, and evaluation
// Matching runtime motivation-rules.js DEFAULT_MOTIVATION_RULES_ARTIFACT
// ══════════════════════════════════════════════════════════════════════════════

// ── Profile axis codes ──
// mobility: stationary=0, exploring=1, patrolling=2
// combat: none=0, attacking=1, defending=2
// cognition: none=0, reflexive=1, goal_oriented=2, strategy_focused=3

// ── Reasoning class codes ──
export const enum ReasoningClass {
  Instinctual = 0,
  Tactical = 1,
  Strategic = 2,
}

// ── Behavior flag bitmask ──
export const enum MotivationFlag {
  CanMove = 1,          // bit 0
  PrefersStealth = 2,   // bit 1
  PrefersCover = 4,     // bit 2
  AggroRangeBoost = 8,  // bit 3
}

const FLAG_COUNT: i32 = 4;

export function getMotivationFlagCount(): i32 {
  return FLAG_COUNT;
}

// ── Per-kind profile axes (1-based index, 0 is sentinel) ──

const PROFILE_MOBILITY = new StaticArray<i32>(13);
const PROFILE_COMBAT = new StaticArray<i32>(13);
const PROFILE_COGNITION = new StaticArray<i32>(13);
const DEFAULT_FLAG_MASK = new StaticArray<i32>(13);
const DEFAULT_DESIGN_COST = new StaticArray<i32>(13);

function initProfileTables(): void {
  // sentinel
  unchecked(PROFILE_MOBILITY[0] = -1);
  unchecked(PROFILE_COMBAT[0] = -1);
  unchecked(PROFILE_COGNITION[0] = -1);
  unchecked(DEFAULT_FLAG_MASK[0] = 0);
  unchecked(DEFAULT_DESIGN_COST[0] = 0);

  // random(1): exploring/none/reflexive, flags=canMove, designCost=0
  unchecked(PROFILE_MOBILITY[1] = 1);
  unchecked(PROFILE_COMBAT[1] = 0);
  unchecked(PROFILE_COGNITION[1] = 1);
  unchecked(DEFAULT_FLAG_MASK[1] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[1] = 0);

  // stationary(2): stationary/none/none, flags=canMove, designCost=0
  unchecked(PROFILE_MOBILITY[2] = 0);
  unchecked(PROFILE_COMBAT[2] = 0);
  unchecked(PROFILE_COGNITION[2] = 0);
  unchecked(DEFAULT_FLAG_MASK[2] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[2] = 0);

  // exploring(3): exploring/none/reflexive, flags=canMove, designCost=0
  unchecked(PROFILE_MOBILITY[3] = 1);
  unchecked(PROFILE_COMBAT[3] = 0);
  unchecked(PROFILE_COGNITION[3] = 1);
  unchecked(DEFAULT_FLAG_MASK[3] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[3] = 0);

  // patrolling(4): patrolling/none/reflexive, flags=canMove, designCost=0
  unchecked(PROFILE_MOBILITY[4] = 2);
  unchecked(PROFILE_COMBAT[4] = 0);
  unchecked(PROFILE_COGNITION[4] = 1);
  unchecked(DEFAULT_FLAG_MASK[4] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[4] = 0);

  // attacking(5): exploring/attacking/goal_oriented, flags=canMove|aggroRangeBoost, designCost=0
  unchecked(PROFILE_MOBILITY[5] = 1);
  unchecked(PROFILE_COMBAT[5] = 1);
  unchecked(PROFILE_COGNITION[5] = 2);
  unchecked(DEFAULT_FLAG_MASK[5] = MotivationFlag.CanMove | MotivationFlag.AggroRangeBoost);
  unchecked(DEFAULT_DESIGN_COST[5] = 0);

  // defending(6): stationary/defending/goal_oriented, flags=canMove|prefersCover, designCost=0
  unchecked(PROFILE_MOBILITY[6] = 0);
  unchecked(PROFILE_COMBAT[6] = 2);
  unchecked(PROFILE_COGNITION[6] = 2);
  unchecked(DEFAULT_FLAG_MASK[6] = MotivationFlag.CanMove | MotivationFlag.PrefersCover);
  unchecked(DEFAULT_DESIGN_COST[6] = 0);

  // stealthy(7): exploring/none/goal_oriented, flags=canMove|prefersStealth, designCost=0
  unchecked(PROFILE_MOBILITY[7] = 1);
  unchecked(PROFILE_COMBAT[7] = 0);
  unchecked(PROFILE_COGNITION[7] = 2);
  unchecked(DEFAULT_FLAG_MASK[7] = MotivationFlag.CanMove | MotivationFlag.PrefersStealth);
  unchecked(DEFAULT_DESIGN_COST[7] = 0);

  // friendly(8): exploring/none/reflexive, flags=canMove, designCost=0
  unchecked(PROFILE_MOBILITY[8] = 1);
  unchecked(PROFILE_COMBAT[8] = 0);
  unchecked(PROFILE_COGNITION[8] = 1);
  unchecked(DEFAULT_FLAG_MASK[8] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[8] = 0);

  // reflexive(9): stationary/none/reflexive, flags=canMove, designCost=1
  unchecked(PROFILE_MOBILITY[9] = 0);
  unchecked(PROFILE_COMBAT[9] = 0);
  unchecked(PROFILE_COGNITION[9] = 1);
  unchecked(DEFAULT_FLAG_MASK[9] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[9] = 1);

  // goal_oriented(10): stationary/none/goal_oriented, flags=canMove, designCost=5
  unchecked(PROFILE_MOBILITY[10] = 0);
  unchecked(PROFILE_COMBAT[10] = 0);
  unchecked(PROFILE_COGNITION[10] = 2);
  unchecked(DEFAULT_FLAG_MASK[10] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[10] = 5);

  // strategy_focused(11): stationary/none/strategy_focused, flags=canMove, designCost=20
  unchecked(PROFILE_MOBILITY[11] = 0);
  unchecked(PROFILE_COMBAT[11] = 0);
  unchecked(PROFILE_COGNITION[11] = 3);
  unchecked(DEFAULT_FLAG_MASK[11] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[11] = 20);

  // user_controlled(12): stationary/none/none, flags=canMove, designCost=0
  unchecked(PROFILE_MOBILITY[12] = 0);
  unchecked(PROFILE_COMBAT[12] = 0);
  unchecked(PROFILE_COGNITION[12] = 0);
  unchecked(DEFAULT_FLAG_MASK[12] = MotivationFlag.CanMove);
  unchecked(DEFAULT_DESIGN_COST[12] = 0);
}

let profileTablesInitialized: bool = false;

function ensureProfileTables(): void {
  if (!profileTablesInitialized) {
    initProfileTables();
    profileTablesInitialized = true;
  }
}

// ── Profile cost lookup (from globals.profileCosts) ──
// mobility: stationary=0, exploring=1, patrolling=2
// combat: none=0, attacking=5, defending=4
// cognition: none=0, reflexive=1, goal_oriented=5, strategy_focused=20

const MOBILITY_COST = StaticArray.fromArray<i32>([0, 1, 2]);
const COMBAT_COST = StaticArray.fromArray<i32>([0, 5, 4]);
const COGNITION_COST = StaticArray.fromArray<i32>([0, 1, 5, 20]);

export function getMotivationProfileCost(kind: i32): i32 {
  ensureProfileTables();
  if (!isValidMotivationKind(kind)) return -1;
  const mob = unchecked(PROFILE_MOBILITY[kind]);
  const com = unchecked(PROFILE_COMBAT[kind]);
  const cog = unchecked(PROFILE_COGNITION[kind]);
  return unchecked(MOBILITY_COST[mob]) + unchecked(COMBAT_COST[com]) + unchecked(COGNITION_COST[cog]);
}

export function getMotivationDefaultDesignCost(kind: i32): i32 {
  ensureProfileTables();
  if (!isValidMotivationKind(kind)) return 0;
  return unchecked(DEFAULT_DESIGN_COST[kind]);
}

export function getMotivationDefaultFlagMask(kind: i32): i32 {
  ensureProfileTables();
  if (!isValidMotivationKind(kind)) return 0;
  return unchecked(DEFAULT_FLAG_MASK[kind]);
}

// ── Reasoning class derivation from cognition tier ──

function reasoningClassFromCognition(cognition: i32): i32 {
  if (cognition == 3) return ReasoningClass.Strategic;   // strategy_focused
  if (cognition == 2) return ReasoningClass.Tactical;     // goal_oriented
  return ReasoningClass.Instinctual;                      // none or reflexive
}

// ══════════════════════════════════════════════════════════════════════════════
// §5 Motivation evaluation accumulator
// Accepts primitive entries, computes profile axes (max), flags (OR), reasoning class.
// ══════════════════════════════════════════════════════════════════════════════

const MAX_EVAL_ENTRIES: i32 = 12;

let evalEntryCount: i32 = 0;
let evalMobilityTier: i32 = 0;
let evalCombatTier: i32 = 0;
let evalCognitionTier: i32 = 0;
let evalFlagMask: i32 = 0;
let evalReasoningClass: i32 = 0;

export function resetMotivationEvaluation(): i32 {
  evalEntryCount = 0;
  evalMobilityTier = 0;
  evalCombatTier = 0;
  evalCognitionTier = 0;
  evalFlagMask = 0;
  evalReasoningClass = 0;
  return 1;
}

export function addMotivationEvaluationEntry(kind: i32, intensity: i32, pattern: i32, flagMask: i32): i32 {
  if (!isValidMotivationKind(kind)) return 0;
  if (evalEntryCount >= MAX_EVAL_ENTRIES) return 0;
  ensureProfileTables();

  evalEntryCount += 1;

  // Profile: take max of each axis
  const mob = unchecked(PROFILE_MOBILITY[kind]);
  const com = unchecked(PROFILE_COMBAT[kind]);
  const cog = unchecked(PROFILE_COGNITION[kind]);
  if (mob > evalMobilityTier) evalMobilityTier = mob;
  if (com > evalCombatTier) evalCombatTier = com;
  if (cog > evalCognitionTier) evalCognitionTier = cog;

  // Flags: OR default mask for the kind with explicit mask
  const defaultMask = unchecked(DEFAULT_FLAG_MASK[kind]);
  evalFlagMask = evalFlagMask | defaultMask | flagMask;

  return 1;
}

export function evaluateMotivations(): i32 {
  evalReasoningClass = reasoningClassFromCognition(evalCognitionTier);
  return evalEntryCount;
}

export function getLastMotivationFlags(): i32 {
  return evalFlagMask;
}

export function getLastMotivationMobilityTier(): i32 {
  return evalMobilityTier;
}

export function getLastMotivationCombatTier(): i32 {
  return evalCombatTier;
}

export function getLastMotivationCognitionTier(): i32 {
  return evalCognitionTier;
}

export function getLastMotivationReasoningClass(): i32 {
  return evalReasoningClass;
}
