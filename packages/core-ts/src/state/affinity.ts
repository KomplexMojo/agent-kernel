import { VitalKind } from "./vitals.ts";

export const AffinityKind = {
  Fire: 1,
  Water: 2,
  Earth: 3,
  Wind: 4,
  Life: 5,
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
OPPOSITE_TABLE[AffinityKind.Life] = AffinityKind.Decay;
OPPOSITE_TABLE[AffinityKind.Decay] = AffinityKind.Life;
OPPOSITE_TABLE[AffinityKind.Corrode] = AffinityKind.Fortify;
OPPOSITE_TABLE[AffinityKind.Fortify] = AffinityKind.Corrode;
OPPOSITE_TABLE[AffinityKind.Light] = AffinityKind.Dark;
OPPOSITE_TABLE[AffinityKind.Dark] = AffinityKind.Light;

const VITAL_TARGET_TABLE = new Int32Array(11);
VITAL_TARGET_TABLE[0] = -1;
VITAL_TARGET_TABLE[AffinityKind.Fire] = VitalKind.Health;
VITAL_TARGET_TABLE[AffinityKind.Water] = VitalKind.Health;
VITAL_TARGET_TABLE[AffinityKind.Earth] = VitalKind.Stamina;
VITAL_TARGET_TABLE[AffinityKind.Wind] = VitalKind.Stamina;
VITAL_TARGET_TABLE[AffinityKind.Life] = VitalKind.Health;
VITAL_TARGET_TABLE[AffinityKind.Decay] = VitalKind.Health;
VITAL_TARGET_TABLE[AffinityKind.Corrode] = VitalKind.Durability;
VITAL_TARGET_TABLE[AffinityKind.Fortify] = VitalKind.Durability;
VITAL_TARGET_TABLE[AffinityKind.Light] = VitalKind.Mana;
VITAL_TARGET_TABLE[AffinityKind.Dark] = VitalKind.Mana;

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

export function getAffinityTargetVital(kind: number): number {
  if (!isValidAffinityKind(kind)) return -1;
  return VITAL_TARGET_TABLE[kind];
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

export function affinityExpressionAllowsTrapArming(
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

// ── PR #43 M2: Affinity x Expression x Vital matrix ────────────────────────
//
// 3D matrix mapping (AffinityKind, AffinityExpression, VitalKind) -> signed
// integer base magnitude. Stored as a flat Int32Array of size 10 * 4 * 4 = 160.
//
// Sign convention:
//   - Each affinity has an intrinsic polarity (+1 = buff, -1 = drain) on
//     exactly one primary vital. All other (vital) cells store explicit 0.
//   - Push and Emit carry the polarity sign.
//   - Pull and Draw carry the OPPOSITE sign (sign-reversal pair on same vital).
//   - Push/Pull base magnitude = 2 (single-target, focused intensity).
//   - Emit/Draw base magnitude = 1 (diffuse area, lower per-target intensity).
//
// "No effect" cells are explicit 0 — they reserve the slot so future
// milestones can introduce non-zero cross-vital effects without changing
// the matrix shape or any consumer's lookup contract.

const PRIMARY_VITAL_BY_AFFINITY = new Int32Array(11);
PRIMARY_VITAL_BY_AFFINITY[0] = -1;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Fire] = VitalKind.Health;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Water] = VitalKind.Health;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Earth] = VitalKind.Durability;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Wind] = VitalKind.Stamina;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Life] = VitalKind.Health;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Decay] = VitalKind.Health;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Corrode] = VitalKind.Durability;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Fortify] = VitalKind.Durability;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Light] = VitalKind.Mana;
PRIMARY_VITAL_BY_AFFINITY[AffinityKind.Dark] = VitalKind.Mana;

const POLARITY_BY_AFFINITY = new Int32Array(11);
POLARITY_BY_AFFINITY[0] = 0;
POLARITY_BY_AFFINITY[AffinityKind.Fire] = -1;
POLARITY_BY_AFFINITY[AffinityKind.Water] = +1;
POLARITY_BY_AFFINITY[AffinityKind.Earth] = +1;
POLARITY_BY_AFFINITY[AffinityKind.Wind] = -1;
POLARITY_BY_AFFINITY[AffinityKind.Life] = +1;
POLARITY_BY_AFFINITY[AffinityKind.Decay] = -1;
POLARITY_BY_AFFINITY[AffinityKind.Corrode] = -1;
POLARITY_BY_AFFINITY[AffinityKind.Fortify] = +1;
POLARITY_BY_AFFINITY[AffinityKind.Light] = +1;
POLARITY_BY_AFFINITY[AffinityKind.Dark] = -1;

const BASE_MAGNITUDE_PUSH_PULL = 2;
const BASE_MAGNITUDE_EMIT_DRAW = 1;

const VITAL_KIND_COUNT = 4;
const AFFINITY_VITAL_MATRIX_SIZE =
  AFFINITY_KIND_COUNT * AFFINITY_EXPRESSION_COUNT * VITAL_KIND_COUNT;

const AFFINITY_VITAL_MATRIX = buildAffinityVitalMatrix();

function isValidVitalKind(vital: number): boolean {
  return Number.isInteger(vital) && vital >= 0 && vital < VITAL_KIND_COUNT;
}

function matrixIndex(kind: number, expression: number, vital: number): number {
  // Flatten (kind, expression, vital) into a row-major flat index.
  // kind ∈ [1, 10] is stored at row (kind - 1) so indices stay in [0, 160).
  return (
    (kind - 1) * AFFINITY_EXPRESSION_COUNT * VITAL_KIND_COUNT
    + (expression - 1) * VITAL_KIND_COUNT
    + vital
  );
}

function buildAffinityVitalMatrix(): Int32Array {
  const table = new Int32Array(AFFINITY_VITAL_MATRIX_SIZE);
  for (let kind = AFFINITY_KIND_MIN; kind <= AFFINITY_KIND_MAX; kind += 1) {
    const primaryVital = PRIMARY_VITAL_BY_AFFINITY[kind];
    const polarity = POLARITY_BY_AFFINITY[kind];
    for (
      let expr = AFFINITY_EXPRESSION_MIN;
      expr <= AFFINITY_EXPRESSION_MAX;
      expr += 1
    ) {
      const isFocused =
        expr === AffinityExpression.Push || expr === AffinityExpression.Pull;
      const isReversed =
        expr === AffinityExpression.Pull || expr === AffinityExpression.Draw;
      const magnitude = isFocused
        ? BASE_MAGNITUDE_PUSH_PULL
        : BASE_MAGNITUDE_EMIT_DRAW;
      const sign = isReversed ? -polarity : polarity;
      const cellValue = sign * magnitude;
      for (let vital = 0; vital < VITAL_KIND_COUNT; vital += 1) {
        // Only the primary vital carries a non-zero magnitude.
        // All other vital cells default to 0 (explicit "no effect").
        table[matrixIndex(kind, expr, vital)] =
          vital === primaryVital ? cellValue : 0;
      }
    }
  }
  return table;
}

/**
 * Look up the signed base magnitude for an (affinity, expression, vital)
 * cell in the matrix. Returns 0 for any out-of-range input and for
 * "no effect" cells (every cell that is not on the affinity's primary vital).
 */
export function getAffinityVitalEffectBase(
  kind: number,
  expression: number,
  vital: number,
): number {
  if (!isValidAffinityKind(kind)) return 0;
  if (!isValidAffinityExpression(expression)) return 0;
  if (!isValidVitalKind(vital)) return 0;
  return AFFINITY_VITAL_MATRIX[matrixIndex(kind, expression, vital)];
}

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

/**
 * Convenience composition: the scaled signed effect for an
 * (affinity, expression, vital, stacks) tuple. Equivalent to
 * `scaleAffinityVitalEffect(getAffinityVitalEffectBase(kind, expression, vital), stacks)`.
 */
export function getAffinityVitalEffect(
  kind: number,
  expression: number,
  vital: number,
  stacks: number,
): number {
  const base = getAffinityVitalEffectBase(kind, expression, vital);
  return scaleAffinityVitalEffect(base, stacks);
}
