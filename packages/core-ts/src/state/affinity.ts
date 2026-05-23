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

