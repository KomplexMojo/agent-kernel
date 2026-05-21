// Affinity codebook — deterministic constants and lookup helpers.
// No IO, no imports outside core-as. All codes are i32-safe.

import { VitalKind } from "./world";

// ── Affinity Kind (1-based, matching existing static trap codes) ──

export const enum AffinityKind {
  Fire = 1,
  Water = 2,
  Earth = 3,
  Wind = 4,
  Life = 5,
  Decay = 6,
  Corrode = 7,
  Fortify = 8,
  Light = 9,
  Dark = 10,
}

const AFFINITY_KIND_COUNT: i32 = 10;
const AFFINITY_KIND_MIN: i32 = 1;
const AFFINITY_KIND_MAX: i32 = 10;

export function getAffinityKindCount(): i32 {
  return AFFINITY_KIND_COUNT;
}

export function isValidAffinityKind(kind: i32): bool {
  return kind >= AFFINITY_KIND_MIN && kind <= AFFINITY_KIND_MAX;
}

// ── Affinity Expression (1-based, matching existing trap expression codes) ──

export const enum AffinityExpression {
  Push = 1,
  Pull = 2,
  Emit = 3,
  Draw = 4,
}

const AFFINITY_EXPRESSION_COUNT: i32 = 4;
const AFFINITY_EXPRESSION_MIN: i32 = 1;
const AFFINITY_EXPRESSION_MAX: i32 = 4;

export function getAffinityExpressionCount(): i32 {
  return AFFINITY_EXPRESSION_COUNT;
}

export function isValidAffinityExpression(expression: i32): bool {
  return expression >= AFFINITY_EXPRESSION_MIN && expression <= AFFINITY_EXPRESSION_MAX;
}

// ── Affinity Target Type (0-based, internal) ──

export const enum AffinityTargetType {
  Self = 0,
  Ally = 1,
  Enemy = 2,
  Area = 3,
  Barrier = 4,
  Floor = 5,
}

const AFFINITY_TARGET_TYPE_COUNT: i32 = 6;

export function getAffinityTargetTypeCount(): i32 {
  return AFFINITY_TARGET_TYPE_COUNT;
}

// ── Affinity Relationship ──

export const enum AffinityRelationship {
  Same = 0,
  Opposite = 1,
  Neutral = 2,
}

// ── Opposite pairs (bidirectional lookup table) ──

// Indexed by kind code (1-based). Index 0 is unused sentinel.
const OPPOSITE_TABLE = new StaticArray<i32>(11);

function initOppositeTable(): void {
  unchecked(OPPOSITE_TABLE[AffinityKind.Fire] = AffinityKind.Water);
  unchecked(OPPOSITE_TABLE[AffinityKind.Water] = AffinityKind.Fire);
  unchecked(OPPOSITE_TABLE[AffinityKind.Earth] = AffinityKind.Wind);
  unchecked(OPPOSITE_TABLE[AffinityKind.Wind] = AffinityKind.Earth);
  unchecked(OPPOSITE_TABLE[AffinityKind.Life] = AffinityKind.Decay);
  unchecked(OPPOSITE_TABLE[AffinityKind.Decay] = AffinityKind.Life);
  unchecked(OPPOSITE_TABLE[AffinityKind.Corrode] = AffinityKind.Fortify);
  unchecked(OPPOSITE_TABLE[AffinityKind.Fortify] = AffinityKind.Corrode);
  unchecked(OPPOSITE_TABLE[AffinityKind.Light] = AffinityKind.Dark);
  unchecked(OPPOSITE_TABLE[AffinityKind.Dark] = AffinityKind.Light);
}

let oppositeTableInitialized: bool = false;

function ensureOppositeTable(): void {
  if (!oppositeTableInitialized) {
    initOppositeTable();
    oppositeTableInitialized = true;
  }
}

export function getOppositeAffinityKind(kind: i32): i32 {
  ensureOppositeTable();
  if (!isValidAffinityKind(kind)) return 0;
  return unchecked(OPPOSITE_TABLE[kind]);
}

export function resolveAffinityRelationshipCode(sourceKind: i32, targetKind: i32): i32 {
  if (!isValidAffinityKind(sourceKind) || !isValidAffinityKind(targetKind)) return -1;
  if (sourceKind == targetKind) return AffinityRelationship.Same;
  ensureOppositeTable();
  if (unchecked(OPPOSITE_TABLE[sourceKind]) == targetKind) return AffinityRelationship.Opposite;
  return AffinityRelationship.Neutral;
}

// ── Vital target mapping (kind → VitalKind) ──

// Indexed by kind code (1-based). Index 0 is unused sentinel (-1).
const VITAL_TARGET_TABLE = new StaticArray<i32>(11);

function initVitalTargetTable(): void {
  unchecked(VITAL_TARGET_TABLE[0] = -1);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Fire] = VitalKind.Health);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Water] = VitalKind.Health);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Earth] = VitalKind.Stamina);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Wind] = VitalKind.Stamina);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Life] = VitalKind.Health);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Decay] = VitalKind.Health);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Corrode] = VitalKind.Durability);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Fortify] = VitalKind.Durability);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Light] = VitalKind.Mana);
  unchecked(VITAL_TARGET_TABLE[AffinityKind.Dark] = VitalKind.Mana);
}

let vitalTargetTableInitialized: bool = false;

function ensureVitalTargetTable(): void {
  if (!vitalTargetTableInitialized) {
    initVitalTargetTable();
    vitalTargetTableInitialized = true;
  }
}

export function getAffinityTargetVital(kind: i32): i32 {
  ensureVitalTargetTable();
  if (!isValidAffinityKind(kind)) return -1;
  return unchecked(VITAL_TARGET_TABLE[kind]);
}

// ── Default target type by expression ──

// Indexed by expression code (1-based). Index 0 is unused sentinel (-1).
const DEFAULT_TARGET_TYPE_TABLE = new StaticArray<i32>(5);

function initDefaultTargetTypeTable(): void {
  unchecked(DEFAULT_TARGET_TYPE_TABLE[0] = -1);
  unchecked(DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Push] = AffinityTargetType.Enemy);
  unchecked(DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Pull] = AffinityTargetType.Self);
  unchecked(DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Emit] = AffinityTargetType.Area);
  unchecked(DEFAULT_TARGET_TYPE_TABLE[AffinityExpression.Draw] = AffinityTargetType.Self);
}

let defaultTargetTypeTableInitialized: bool = false;

function ensureDefaultTargetTypeTable(): void {
  if (!defaultTargetTypeTableInitialized) {
    initDefaultTargetTypeTable();
    defaultTargetTypeTableInitialized = true;
  }
}

export function getDefaultAffinityTargetType(expression: i32): i32 {
  ensureDefaultTargetTypeTable();
  if (!isValidAffinityExpression(expression)) return -1;
  return unchecked(DEFAULT_TARGET_TYPE_TABLE[expression]);
}

// ── Expression profile flags ──

export function affinityExpressionAllowsEnvironmentMutation(expression: i32): bool {
  // push, pull, emit allow environment mutation; draw does not
  if (!isValidAffinityExpression(expression)) return false;
  return expression != AffinityExpression.Draw;
}

export function affinityExpressionAllowsTrapArming(expression: i32): bool {
  // push, pull, emit allow trap arming; draw does not
  if (!isValidAffinityExpression(expression)) return false;
  return expression != AffinityExpression.Draw;
}

export function affinityExpressionIsPersistentField(expression: i32): bool {
  // emit and draw are persistent/field channel; push and pull are spatial/instantaneous
  if (!isValidAffinityExpression(expression)) return false;
  return expression == AffinityExpression.Emit || expression == AffinityExpression.Draw;
}
