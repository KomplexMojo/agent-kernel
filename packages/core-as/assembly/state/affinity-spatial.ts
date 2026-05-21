// Affinity spatial formulas and 48-cell interaction matrix.
// All weights are embedded as constants matching runtime SPATIAL_WEIGHTS.
// No IO, no imports outside core-as.

import {
  AffinityExpression,
  isValidAffinityExpression,
  isValidAffinityKind,
  resolveAffinityRelationshipCode,
} from "./affinity";
import {
  getMotivatedActorAffinityKindByIndex,
  getMotivatedActorAffinityExpressionByIndex,
  getMotivatedActorAffinityStacksByIndex,
} from "./world";

// ── Expression index helper (1-based code → 0-based index) ──

function exprIdx(expression: i32): i32 {
  return expression - 1;
}

// ── Effect codes (for matrix cells) ──

export const enum AffinityEffect {
  None = 0,
  Damage = 1,
  ConditionalDamage = 2,
  PotencyReduced = 3,
  ManaGain = 4,
  ManaLoss = 5,
  AmplifiedDamage = 6,
}

// ── Visual state codes (1-based, matching runtime VISUAL_STATES order) ──

export const enum AffinityVisualState {
  ClashNeutral = 1,
  ClashOpposed = 2,
  Redirect = 3,
  Conflict = 4,
  Disruption = 5,
  Strike = 6,
  Vulnerability = 7,
  Backlash = 8,
  Siphon = 9,
  MutualDrain = 10,
  Absorb = 11,
  ToxicExposure = 12,
  Tug = 13,
  Rend = 14,
  Reinforcement = 15,
  ConflictZone = 16,
  Susceptible = 17,
  Resonance = 18,
  Corrosion = 19,
  Layered = 20,
  EmitField = 21,
}

export function getAffinityVisualStateCount(): i32 {
  return 21;
}

export function getAffinityEffectCount(): i32 {
  return 7; // None through AmplifiedDamage
}

// ══════════════════════════════════════════════════════════════════════════════
// §1.1 Radius weights: radius = floor(baseRadius + radiusGrowth * stacks^radiusExponent)
// ══════════════════════════════════════════════════════════════════════════════

// Indexed [exprIdx]: push=0, pull=1, emit=2, draw=3
const RADIUS_BASE     = StaticArray.fromArray<f64>([0.5, 0.5, 1.0, 1.0]);
const RADIUS_GROWTH   = StaticArray.fromArray<f64>([0.5, 0.5, 1.0, 0.0]);
const RADIUS_EXPONENT = StaticArray.fromArray<f64>([1.0, 1.0, 1.0, 1.0]);

export function computeAffinityRadius(expression: i32, stacks: i32): i32 {
  if (!isValidAffinityExpression(expression)) return 1;
  const s: f64 = stacks >= 1 ? <f64>stacks : 1.0;
  const idx = exprIdx(expression);
  const base = unchecked(RADIUS_BASE[idx]);
  const growth = unchecked(RADIUS_GROWTH[idx]);
  const exp = unchecked(RADIUS_EXPONENT[idx]);
  return <i32>Math.floor(base + growth * Math.pow(s, exp));
}

// ══════════════════════════════════════════════════════════════════════════════
// §1.2 Intensity falloff
// intensity(d, stacks) = peak * stacks^stackExp * max(0, 1 - ((d-buffer)/radius)^falloff)
// ══════════════════════════════════════════════════════════════════════════════

const INTENSITY_PEAK       = StaticArray.fromArray<f64>([1.0, 1.0, 1.0, 1.0]);
const INTENSITY_STACK_EXP  = StaticArray.fromArray<f64>([0.5, 0.5, 0.3, 0.0]);
const INTENSITY_BUFFER     = StaticArray.fromArray<i32>([0, 0, 1, 0]);
const INTENSITY_FALLOFF    = StaticArray.fromArray<f64>([2.0, 2.0, 1.0, 0.0]);

export function computeAffinityIntensity(distance: i32, stacks: i32, expression: i32): f64 {
  if (!isValidAffinityExpression(expression)) return 0.0;
  const s: f64 = stacks >= 1 ? <f64>stacks : 1.0;
  const dist = distance >= 0 ? distance : 0;
  const idx = exprIdx(expression);
  const buffer = unchecked(INTENSITY_BUFFER[idx]);
  const peak = unchecked(INTENSITY_PEAK[idx]);
  const stackExp = unchecked(INTENSITY_STACK_EXP[idx]);
  const falloffCurve = unchecked(INTENSITY_FALLOFF[idx]);

  // Buffer zone: no effect
  if (dist <= buffer) return 0.0;

  const radius = computeAffinityRadius(expression, stacks);
  if (dist > radius) return 0.0;

  // Flat falloff (draw): full intensity
  if (falloffCurve == 0.0) {
    return peak * Math.pow(s, stackExp);
  }

  const normalizedDist = <f64>(dist - buffer) / <f64>radius;
  const falloff = Math.max(0.0, 1.0 - Math.pow(normalizedDist, falloffCurve));
  return peak * Math.pow(s, stackExp) * falloff;
}

// ══════════════════════════════════════════════════════════════════════════════
// §1.3 Potency: potency = basePotency + potencyGrowth * stacks^potencyExponent
// ══════════════════════════════════════════════════════════════════════════════

const POTENCY_BASE     = StaticArray.fromArray<f64>([0.0, 0.0, 0.0, 0.0]);
const POTENCY_GROWTH   = StaticArray.fromArray<f64>([1.0, 1.0, 1.0, 1.0]);
const POTENCY_EXPONENT = StaticArray.fromArray<f64>([2.0, 1.0, 1.0, 1.0]);

export function computeAffinityPotency(stacks: i32, expression: i32): f64 {
  if (!isValidAffinityExpression(expression)) return 0.0;
  const s: f64 = stacks >= 1 ? <f64>stacks : 1.0;
  const idx = exprIdx(expression);
  const base = unchecked(POTENCY_BASE[idx]);
  const growth = unchecked(POTENCY_GROWTH[idx]);
  const exp = unchecked(POTENCY_EXPONENT[idx]);
  return base + growth * Math.pow(s, exp);
}

// ══════════════════════════════════════════════════════════════════════════════
// §1.7 Mana cost: manaCost = ceil(baseMana + manaGrowth * stacks^manaExponent)
// ══════════════════════════════════════════════════════════════════════════════

const MANA_BASE     = StaticArray.fromArray<f64>([0.0, 0.0, 1.0, 0.0]);
const MANA_GROWTH   = StaticArray.fromArray<f64>([0.0, 0.0, 0.5, 0.25]);
const MANA_EXPONENT = StaticArray.fromArray<f64>([0.0, 0.0, 2.0, 2.0]);

export function computeAffinityManaCost(stacks: i32, expression: i32): i32 {
  if (!isValidAffinityExpression(expression)) return 0;
  const s: f64 = stacks >= 1 ? <f64>stacks : 1.0;
  const idx = exprIdx(expression);
  const base = unchecked(MANA_BASE[idx]);
  const growth = unchecked(MANA_GROWTH[idx]);
  const exp = unchecked(MANA_EXPONENT[idx]);
  return <i32>Math.ceil(base + growth * Math.pow(s, exp));
}

// ══════════════════════════════════════════════════════════════════════════════
// §1.4 Opposite affinity stack cancellation (last-result pattern)
// canceled = min(s, t); netSource = s - canceled; netTarget = t - canceled
// ══════════════════════════════════════════════════════════════════════════════

let lastCanceled: i32 = 0;
let lastNetSource: i32 = 0;
let lastNetTarget: i32 = 0;

export function resolveAffinityStackCancellation(sourceStacks: i32, targetStacks: i32): i32 {
  const s = sourceStacks >= 1 ? sourceStacks : 1;
  const t = targetStacks >= 1 ? targetStacks : 1;
  lastCanceled = s < t ? s : t;
  lastNetSource = s - lastCanceled;
  lastNetTarget = t - lastCanceled;
  return lastCanceled;
}

export function getLastAffinityCanceledStacks(): i32 {
  return lastCanceled;
}

export function getLastAffinityNetSourceStacks(): i32 {
  return lastNetSource;
}

export function getLastAffinityNetTargetStacks(): i32 {
  return lastNetTarget;
}

// ══════════════════════════════════════════════════════════════════════════════
// §1.5 Same-kind merge: mergedStacks = min(s + t, maxMergedStacks)
// ══════════════════════════════════════════════════════════════════════════════

const MAX_MERGED_STACKS: i32 = 8;

export function resolveAffinityMergedStacks(sourceStacks: i32, targetStacks: i32): i32 {
  const s = sourceStacks >= 1 ? sourceStacks : 1;
  const t = targetStacks >= 1 ? targetStacks : 1;
  const sum = s + t;
  return sum < MAX_MERGED_STACKS ? sum : MAX_MERGED_STACKS;
}

// ══════════════════════════════════════════════════════════════════════════════
// 48-cell interaction matrix (flattened)
// cellIndex = (((srcExpr-1)*4 + (tgtExpr-1)) * 3) + relationship
// ══════════════════════════════════════════════════════════════════════════════

const MATRIX_CELL_COUNT: i32 = 48;

export function getAffinityInteractionCellCount(): i32 {
  return MATRIX_CELL_COUNT;
}

function cellIndex(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  return (((srcExpr - 1) * 4 + (tgtExpr - 1)) * 3) + relationship;
}

// Four parallel arrays of 48 entries each
// @ts-ignore: decorator
@inline const S = AffinityEffect.None;
// Shorthand aliases for readability in table initialization
const N = AffinityEffect.None;
const D = AffinityEffect.Damage;
const CD = AffinityEffect.ConditionalDamage;
const PR = AffinityEffect.PotencyReduced;
const MG = AffinityEffect.ManaGain;
const ML = AffinityEffect.ManaLoss;
const AD = AffinityEffect.AmplifiedDamage;

// Source effect per cell
const MATRIX_SRC_EFFECT = StaticArray.fromArray<i32>([
  // Push(src) encounters — push/pull/emit/draw targets × same/opp/neut
  N,  CD, N,   N,  D,  N,   N,  PR, N,   N,  N,  N,   // push→{push,pull,emit,draw}
  // Pull(src) encounters
  N,  D,  N,   MG, D,  N,   MG, D,  N,   MG, D,  N,   // pull→{push,pull,emit,draw}
  // Emit(src) encounters
  N,  PR, N,   N,  PR, N,   N,  PR, N,   N,  N,  N,   // emit→{push,pull,emit,draw}
  // Draw(src) encounters
  D,  AD, N,   ML, ML, N,   MG, D,  N,   N,  D,  N,   // draw→{push,pull,emit,draw}
]);

// Target effect per cell
const MATRIX_TGT_EFFECT = StaticArray.fromArray<i32>([
  // Push(src) encounters
  N,  CD, N,   N,  D,  N,   N,  PR, N,   D,  AD, N,   // push→{push,pull,emit,draw}
  // Pull(src) encounters
  N,  N,  N,   ML, D,  N,   N,  PR, N,   ML, ML, N,   // pull→{push,pull,emit,draw}
  // Emit(src) encounters
  N,  PR, N,   MG, D,  N,   N,  PR, N,   MG, D,  N,   // emit→{push,pull,emit,draw}
  // Draw(src) encounters
  N,  N,  N,   MG, D,  N,   N,  N,  N,   N,  D,  N,   // draw→{push,pull,emit,draw}
]);

// Visual state per cell
const MATRIX_VISUAL = StaticArray.fromArray<i32>([
  // Push(src) encounters
  1,  2,  20,  3,  4,  20,  21, 5,  20,  6,  7,  20,  // push→{push,pull,emit,draw}
  // Pull(src) encounters
  3,  8,  20,  9,  10, 20,  11, 12, 20,  13, 14, 20,  // pull→{push,pull,emit,draw}
  // Emit(src) encounters
  21, 5,  20,  11, 12, 20,  15, 16, 20,  11, 17, 20,  // emit→{push,pull,emit,draw}
  // Draw(src) encounters
  6,  7,  20,  13, 14, 20,  11, 17, 20,  18, 19, 20,  // draw→{push,pull,emit,draw}
]);

// Uses stack cancellation per cell (0 or 1)
const MATRIX_CANCEL = StaticArray.fromArray<i32>([
  // Push(src) encounters
  0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,   // push→{push,pull,emit,draw}
  // Pull(src) encounters
  0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,   // pull→{push,pull,emit,draw}
  // Emit(src) encounters
  0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,   // emit→{push,pull,emit,draw}
  // Draw(src) encounters
  0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,   // draw→{push,pull,emit,draw}
]);

function isValidCellArgs(srcExpr: i32, tgtExpr: i32, relationship: i32): bool {
  return isValidAffinityExpression(srcExpr) &&
         isValidAffinityExpression(tgtExpr) &&
         relationship >= 0 && relationship <= 2;
}

export function getAffinityMatrixSourceEffect(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return unchecked(MATRIX_SRC_EFFECT[cellIndex(srcExpr, tgtExpr, relationship)]);
}

export function getAffinityMatrixTargetEffect(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return unchecked(MATRIX_TGT_EFFECT[cellIndex(srcExpr, tgtExpr, relationship)]);
}

export function getAffinityMatrixVisualState(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return unchecked(MATRIX_VISUAL[cellIndex(srcExpr, tgtExpr, relationship)]);
}

export function getAffinityMatrixUsesStackCancellation(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return unchecked(MATRIX_CANCEL[cellIndex(srcExpr, tgtExpr, relationship)]);
}

// ══════════════════════════════════════════════════════════════════════════════
// Interaction resolution (last-result pattern)
// resolveAffinityInteraction: matrix lookup + optional stack cancellation
// resolveMotivatedActorAffinityInteraction: reads actor affinities, delegates
// ══════════════════════════════════════════════════════════════════════════════

let lastInteractionSourceEffect: i32 = 0;
let lastInteractionTargetEffect: i32 = 0;
let lastInteractionVisualState: i32 = 0;
let lastInteractionRelationship: i32 = 0;
let lastInteractionNetSourceStacks: i32 = 0;
let lastInteractionNetTargetStacks: i32 = 0;
let lastInteractionCanceledStacks: i32 = 0;

export function resolveAffinityInteraction(
  srcKind: i32, srcExpr: i32, srcStacks: i32,
  tgtKind: i32, tgtExpr: i32, tgtStacks: i32,
): i32 {
  // Validate inputs
  if (!isValidAffinityKind(srcKind) || !isValidAffinityKind(tgtKind)) return 0;
  if (!isValidAffinityExpression(srcExpr) || !isValidAffinityExpression(tgtExpr)) return 0;
  if (srcStacks < 1 || tgtStacks < 1) return 0;

  // Resolve relationship
  const relationship = resolveAffinityRelationshipCode(srcKind, tgtKind);
  if (relationship < 0) return 0;

  lastInteractionRelationship = relationship;

  // Matrix lookup
  const idx = cellIndex(srcExpr, tgtExpr, relationship);
  lastInteractionSourceEffect = unchecked(MATRIX_SRC_EFFECT[idx]);
  lastInteractionTargetEffect = unchecked(MATRIX_TGT_EFFECT[idx]);
  lastInteractionVisualState = unchecked(MATRIX_VISUAL[idx]);

  // Stack cancellation (only for opposite, when matrix cell says so)
  const usesCancel = unchecked(MATRIX_CANCEL[idx]);
  if (usesCancel) {
    const canceled = srcStacks < tgtStacks ? srcStacks : tgtStacks;
    lastInteractionCanceledStacks = canceled;
    lastInteractionNetSourceStacks = srcStacks - canceled;
    lastInteractionNetTargetStacks = tgtStacks - canceled;
  } else {
    lastInteractionCanceledStacks = 0;
    lastInteractionNetSourceStacks = srcStacks;
    lastInteractionNetTargetStacks = tgtStacks;
  }

  return 1;
}

export function resolveMotivatedActorAffinityInteraction(
  srcActorIndex: i32, tgtActorIndex: i32,
): i32 {
  const srcKind = getMotivatedActorAffinityKindByIndex(srcActorIndex);
  const srcExpr = getMotivatedActorAffinityExpressionByIndex(srcActorIndex);
  const srcStacks = getMotivatedActorAffinityStacksByIndex(srcActorIndex);
  const tgtKind = getMotivatedActorAffinityKindByIndex(tgtActorIndex);
  const tgtExpr = getMotivatedActorAffinityExpressionByIndex(tgtActorIndex);
  const tgtStacks = getMotivatedActorAffinityStacksByIndex(tgtActorIndex);

  // If either actor lacks affinity data, resolution fails
  if (srcKind == 0 || tgtKind == 0) return 0;
  if (srcExpr == 0 || tgtExpr == 0) return 0;
  if (srcStacks < 1 || tgtStacks < 1) return 0;

  return resolveAffinityInteraction(srcKind, srcExpr, srcStacks, tgtKind, tgtExpr, tgtStacks);
}

export function getLastInteractionSourceEffect(): i32 {
  return lastInteractionSourceEffect;
}

export function getLastInteractionTargetEffect(): i32 {
  return lastInteractionTargetEffect;
}

export function getLastInteractionVisualState(): i32 {
  return lastInteractionVisualState;
}

export function getLastInteractionRelationship(): i32 {
  return lastInteractionRelationship;
}

export function getLastInteractionNetSourceStacks(): i32 {
  return lastInteractionNetSourceStacks;
}

export function getLastInteractionNetTargetStacks(): i32 {
  return lastInteractionNetTargetStacks;
}

export function getLastInteractionCanceledStacks(): i32 {
  return lastInteractionCanceledStacks;
}
