
export const AffinityKind = {
  Fire: 1,
  Water: 2,
  Earth: 3,
  Wind: 4,
  Growth: 5,
  Decay: 6,
  Corrode: 7,
  Fortify: 8,
  Light: 9,
  Dark: 10,
} as const;

export const AffinityExpression = {
  Push: 1,
  Pull: 2,
  Emit: 3,
  Draw: 4,
} as const;

export const AffinityTargetType = {
  Self: 0,
  Ally: 1,
  Enemy: 2,
  Area: 3,
  Barrier: 4,
  Floor: 5,
} as const;

export const AffinityRelationship = {
  Same: 0,
  Opposite: 1,
  Neutral: 2,
} as const;

/**
 * Affinity grant slots held per motivated actor — one per AffinityKind.
 *
 * A grant's category is derived, never flagged:
 *   manaMax === 0            → innate  (no pool, never expires)
 *   manaMax > 0, regen === 0 → temporary (removed whole at mana 0)
 *   manaMax > 0, regen > 0   → permanent (refills, never removed)
 */
export const MAX_AFFINITY_GRANTS_PER_ACTOR = 10;

const AFFINITY_KIND_COUNT = 10;
const AFFINITY_KIND_MIN = 1;
const AFFINITY_KIND_MAX = 10;
const AFFINITY_EXPRESSION_COUNT = 4;
const AFFINITY_EXPRESSION_MIN = 1;
const AFFINITY_EXPRESSION_MAX = 4;
const AFFINITY_TARGET_TYPE_COUNT = 6;

const OPPOSITE_TABLE = new Int32Array(11);
OPPOSITE_TABLE[AffinityKind.Fire] = AffinityKind.Water;
OPPOSITE_TABLE[AffinityKind.Water] = AffinityKind.Fire;
OPPOSITE_TABLE[AffinityKind.Earth] = AffinityKind.Wind;
OPPOSITE_TABLE[AffinityKind.Wind] = AffinityKind.Earth;
OPPOSITE_TABLE[AffinityKind.Growth] = AffinityKind.Decay;
OPPOSITE_TABLE[AffinityKind.Decay] = AffinityKind.Growth;
OPPOSITE_TABLE[AffinityKind.Corrode] = AffinityKind.Fortify;
OPPOSITE_TABLE[AffinityKind.Fortify] = AffinityKind.Corrode;
OPPOSITE_TABLE[AffinityKind.Light] = AffinityKind.Dark;
OPPOSITE_TABLE[AffinityKind.Dark] = AffinityKind.Light;

const DEFAULT_TARGET_TYPE_TABLE = new Int32Array(5);
DEFAULT_TARGET_TYPE_TABLE[0] = -1;
DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Push] = AffinityTargetType.Enemy;
DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Pull] = AffinityTargetType.Self;
DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Emit] = AffinityTargetType.Area;
DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Draw] = AffinityTargetType.Self;

export function getAffinityKindCount(): number {
  return AFFINITY_KIND_COUNT;
}

export function isValidAffinityKind(kind: number): boolean {
  return kind >= AFFINITY_KIND_MIN && kind <= AFFINITY_KIND_MAX;
}

export function getAffinityExpressionCount(): number {
  return AFFINITY_EXPRESSION_COUNT;
}

export function isValidAffinityExpression(expression: number): boolean {
  return (
    expression >= AFFINITY_EXPRESSION_MIN &&
    expression <= AFFINITY_EXPRESSION_MAX
  );
}

export function getAffinityTargetTypeCount(): number {
  return AFFINITY_TARGET_TYPE_COUNT;
}

export function getOppositeAffinityKind(kind: number): number {
  if (!isValidAffinityKind(kind)) return 0;
  return OPPOSITE_TABLE[kind];
}

export function resolveAffinityRelationshipCode(
  sourceKind: number,
  targetKind: number,
): number {
  if (!isValidAffinityKind(sourceKind) || !isValidAffinityKind(targetKind)) {
    return -1;
  }
  if (sourceKind === targetKind) return AffinityRelationship.Same;
  if (OPPOSITE_TABLE[sourceKind] === targetKind) {
    return AffinityRelationship.Opposite;
  }
  return AffinityRelationship.Neutral;
}

export function getDefaultAffinityTargetType(expression: number): number {
  if (!isValidAffinityExpression(expression)) return -1;
  return DEFAULT_TARGET_TYPE_TABLE[expression];
}

export function affinityExpressionAllowsEnvironmentMutation(
  expression: number,
): boolean {
  if (!isValidAffinityExpression(expression)) return false;
  return expression !== AffinityExpression.Draw;
}

export function affinityExpressionAllowsHazardArming(
  expression: number,
): boolean {
  if (!isValidAffinityExpression(expression)) return false;
  return expression !== AffinityExpression.Draw;
}

export function affinityExpressionIsPersistentField(
  expression: number,
): boolean {
  if (!isValidAffinityExpression(expression)) return false;
  return (
    expression === AffinityExpression.Emit ||
    expression === AffinityExpression.Draw
  );
}

const BASE_MAGNITUDE_PUSH_PULL = 2;
const BASE_MAGNITUDE_EMIT_DRAW = 1;

/**
 * Pure stack-scaling formula. For this milestone the formula is uniform
 * linear `effect = base * stacks`. Negative stacks are rejected (return 0)
 * so callers don't accidentally invert sign by passing a negative count.
 *
 * Exposed as a separate function so future milestones can introduce
 * per-triple custom formulas without touching call sites.
 */
export function scaleAffinityVitalEffect(base: number, stacks: number): number {
  if (!Number.isInteger(stacks) || stacks < 0) return 0;
  if (!Number.isFinite(base)) return 0;
  // Short-circuit when either operand is 0 to avoid -0 from base < 0.
  // JS treats `-2 * 0` as -0, which Object.is distinguishes from +0.
  if (stacks === 0 || base === 0) return 0;
  return base * stacks;
}

/** Unsigned balance baseline; which vital a kind hits and how is the affinity table (#352). */
export function getAffinityExpressionBaseMagnitude(expression: number): number {
  if (!isValidAffinityExpression(expression)) return 0;
  return expression === AffinityExpression.Push || expression === AffinityExpression.Pull
    ? BASE_MAGNITUDE_PUSH_PULL : BASE_MAGNITUDE_EMIT_DRAW;
}
