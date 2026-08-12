import {
  isValidAffinityExpression,
  isValidAffinityKind,
  resolveAffinityRelationshipCode,
} from "./affinity.ts";

export interface MotivatedActorAffinityReaders {
  getMotivatedActorAffinityKindByIndex(index: number): number;
  getMotivatedActorAffinityExpressionByIndex(index: number): number;
  getMotivatedActorAffinityStacksByIndex(index: number): number;
}

export const AffinityEffect = {
  None: 0,
  Damage: 1,
  ConditionalDamage: 2,
  PotencyReduced: 3,
  ManaGain: 4,
  ManaLoss: 5,
  AmplifiedDamage: 6,
} as const;

const RADIUS_BASE = Object.freeze([0.5, 0.5, 1.0, 1.0]);
const RADIUS_GROWTH = Object.freeze([0.5, 0.5, 1.0, 0.0]);
const RADIUS_EXPONENT = Object.freeze([1.0, 1.0, 1.0, 1.0]);

const INTENSITY_PEAK = Object.freeze([1.0, 1.0, 1.0, 1.0]);
const INTENSITY_STACK_EXP = Object.freeze([0.5, 0.5, 0.3, 0.0]);
const INTENSITY_BUFFER = Object.freeze([0, 0, 1, 0]);
const INTENSITY_FALLOFF = Object.freeze([2.0, 2.0, 1.0, 0.0]);

const POTENCY_BASE = Object.freeze([0.0, 0.0, 0.0, 0.0]);
const POTENCY_GROWTH = Object.freeze([1.0, 1.0, 1.0, 1.0]);
const POTENCY_EXPONENT = Object.freeze([2.0, 1.0, 1.0, 1.0]);

const MANA_BASE = Object.freeze([0.0, 0.0, 1.0, 0.0]);
const MANA_GROWTH = Object.freeze([0.0, 0.0, 0.5, 0.25]);
const MANA_EXPONENT = Object.freeze([0.0, 0.0, 2.0, 2.0]);

const MAX_MERGED_STACKS = 8;
const MATRIX_CELL_COUNT = 48;

const N = AffinityEffect.None;
const D = AffinityEffect.Damage;
const CD = AffinityEffect.ConditionalDamage;
const PR = AffinityEffect.PotencyReduced;
const MG = AffinityEffect.ManaGain;
const ML = AffinityEffect.ManaLoss;
const AD = AffinityEffect.AmplifiedDamage;

const MATRIX_SRC_EFFECT = new Int32Array([
  N, CD, N, N, D, N, N, PR, N, N, N, N,
  N, D, N, MG, D, N, MG, D, N, MG, D, N,
  N, PR, N, N, PR, N, N, PR, N, N, N, N,
  D, AD, N, ML, ML, N, MG, D, N, N, D, N,
]);

const MATRIX_TGT_EFFECT = new Int32Array([
  N, CD, N, N, D, N, N, PR, N, D, AD, N,
  N, N, N, ML, D, N, N, PR, N, ML, ML, N,
  N, PR, N, MG, D, N, N, PR, N, MG, D, N,
  N, N, N, MG, D, N, N, N, N, N, D, N,
]);

const MATRIX_VISUAL = new Int32Array([
  1, 2, 20, 3, 4, 20, 21, 5, 20, 6, 7, 20,
  3, 8, 20, 9, 10, 20, 11, 12, 20, 13, 14, 20,
  21, 5, 20, 11, 12, 20, 15, 16, 20, 11, 17, 20,
  6, 7, 20, 13, 14, 20, 11, 17, 20, 18, 19, 20,
]);

const MATRIX_CANCEL = new Int32Array([
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
]);

function exprIdx(expression: number): number {
  return expression - 1;
}

export function computeAffinityRadius(
  expression: number,
  stacks: number,
): number {
  if (!isValidAffinityExpression(expression)) return 1;
  const s = stacks >= 1 ? stacks : 1;
  const idx = exprIdx(expression);
  return Math.floor(
    RADIUS_BASE[idx] + RADIUS_GROWTH[idx] * Math.pow(s, RADIUS_EXPONENT[idx]),
  );
}

export function computeAffinityIntensity(
  distance: number,
  stacks: number,
  expression: number,
): number {
  if (!isValidAffinityExpression(expression)) return 0;
  const s = stacks >= 1 ? stacks : 1;
  const dist = distance >= 0 ? distance : 0;
  const idx = exprIdx(expression);
  const buffer = INTENSITY_BUFFER[idx];
  if (dist <= buffer) return 0;

  const radius = computeAffinityRadius(expression, stacks);
  if (dist > radius) return 0;

  const peak = INTENSITY_PEAK[idx];
  const stackExp = INTENSITY_STACK_EXP[idx];
  const falloffCurve = INTENSITY_FALLOFF[idx];
  if (falloffCurve === 0) {
    return peak * Math.pow(s, stackExp);
  }

  const normalizedDist = (dist - buffer) / radius;
  const falloff = Math.max(0, 1 - Math.pow(normalizedDist, falloffCurve));
  return peak * Math.pow(s, stackExp) * falloff;
}

export function computeAffinityPotency(
  stacks: number,
  expression: number,
): number {
  if (!isValidAffinityExpression(expression)) return 0;
  const s = stacks >= 1 ? stacks : 1;
  const idx = exprIdx(expression);
  return POTENCY_BASE[idx] + POTENCY_GROWTH[idx] * Math.pow(s, POTENCY_EXPONENT[idx]);
}

export function computeAffinityManaCost(
  stacks: number,
  expression: number,
): number {
  if (!isValidAffinityExpression(expression)) return 0;
  const s = stacks >= 1 ? stacks : 1;
  const idx = exprIdx(expression);
  return Math.ceil(MANA_BASE[idx] + MANA_GROWTH[idx] * Math.pow(s, MANA_EXPONENT[idx]));
}

export function resolveAffinityMergedStacks(
  sourceStacks: number,
  targetStacks: number,
): number {
  const source = sourceStacks >= 1 ? sourceStacks : 1;
  const target = targetStacks >= 1 ? targetStacks : 1;
  return Math.min(source + target, MAX_MERGED_STACKS);
}

export function getAffinityInteractionCellCount(): number {
  return MATRIX_CELL_COUNT;
}

export function getAffinityVisualStateCount(): number {
  return 21;
}

export function getAffinityEffectCount(): number {
  return 7;
}

function cellIndex(srcExpr: number, tgtExpr: number, relationship: number): number {
  return ((srcExpr - 1) * 4 + (tgtExpr - 1)) * 3 + relationship;
}

function isValidCellArgs(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): boolean {
  return (
    isValidAffinityExpression(srcExpr) &&
    isValidAffinityExpression(tgtExpr) &&
    relationship >= 0 &&
    relationship <= 2
  );
}

export function getAffinityMatrixSourceEffect(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return MATRIX_SRC_EFFECT[cellIndex(srcExpr, tgtExpr, relationship)];
}

export function getAffinityMatrixTargetEffect(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return MATRIX_TGT_EFFECT[cellIndex(srcExpr, tgtExpr, relationship)];
}

export function getAffinityMatrixVisualState(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return MATRIX_VISUAL[cellIndex(srcExpr, tgtExpr, relationship)];
}

export function getAffinityMatrixUsesStackCancellation(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  if (!isValidCellArgs(srcExpr, tgtExpr, relationship)) return -1;
  return MATRIX_CANCEL[cellIndex(srcExpr, tgtExpr, relationship)];
}

export function createAffinitySpatialState(
  readers: MotivatedActorAffinityReaders,
) {
  let lastCanceled = 0;
  let lastNetSource = 0;
  let lastNetTarget = 0;
  let lastInteractionSourceEffect = 0;
  let lastInteractionTargetEffect = 0;
  let lastInteractionVisualState = 0;
  let lastInteractionRelationship = 0;
  let lastInteractionNetSourceStacks = 0;
  let lastInteractionNetTargetStacks = 0;
  let lastInteractionCanceledStacks = 0;

  function resolveAffinityStackCancellation(
    sourceStacks: number,
    targetStacks: number,
  ): number {
    const source = sourceStacks >= 1 ? sourceStacks : 1;
    const target = targetStacks >= 1 ? targetStacks : 1;
    lastCanceled = Math.min(source, target);
    lastNetSource = source - lastCanceled;
    lastNetTarget = target - lastCanceled;
    return lastCanceled;
  }

  function resolveAffinityInteraction(
    srcKind: number,
    srcExpr: number,
    srcStacks: number,
    tgtKind: number,
    tgtExpr: number,
    tgtStacks: number,
  ): number {
    if (!isValidAffinityKind(srcKind) || !isValidAffinityKind(tgtKind)) return 0;
    if (!isValidAffinityExpression(srcExpr) || !isValidAffinityExpression(tgtExpr)) {
      return 0;
    }
    if (srcStacks < 1 || tgtStacks < 1) return 0;

    const relationship = resolveAffinityRelationshipCode(srcKind, tgtKind);
    if (relationship < 0) return 0;

    lastInteractionRelationship = relationship;
    const idx = cellIndex(srcExpr, tgtExpr, relationship);
    lastInteractionSourceEffect = MATRIX_SRC_EFFECT[idx];
    lastInteractionTargetEffect = MATRIX_TGT_EFFECT[idx];
    lastInteractionVisualState = MATRIX_VISUAL[idx];

    if (MATRIX_CANCEL[idx] !== 0) {
      const canceled = Math.min(srcStacks, tgtStacks);
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

  function resolveMotivatedActorAffinityInteraction(
    srcActorIndex: number,
    tgtActorIndex: number,
  ): number {
    const srcKind = readers.getMotivatedActorAffinityKindByIndex(srcActorIndex);
    const srcExpr = readers.getMotivatedActorAffinityExpressionByIndex(srcActorIndex);
    const srcStacks = readers.getMotivatedActorAffinityStacksByIndex(srcActorIndex);
    const tgtKind = readers.getMotivatedActorAffinityKindByIndex(tgtActorIndex);
    const tgtExpr = readers.getMotivatedActorAffinityExpressionByIndex(tgtActorIndex);
    const tgtStacks = readers.getMotivatedActorAffinityStacksByIndex(tgtActorIndex);

    if (srcKind === 0 || tgtKind === 0) return 0;
    if (srcExpr === 0 || tgtExpr === 0) return 0;
    if (srcStacks < 1 || tgtStacks < 1) return 0;
    return resolveAffinityInteraction(srcKind, srcExpr, srcStacks, tgtKind, tgtExpr, tgtStacks);
  }

  return {
    resolveAffinityStackCancellation,
    getLastAffinityCanceledStacks: () => lastCanceled,
    getLastAffinityNetSourceStacks: () => lastNetSource,
    getLastAffinityNetTargetStacks: () => lastNetTarget,
    resolveAffinityInteraction,
    resolveMotivatedActorAffinityInteraction,
    getLastInteractionSourceEffect: () => lastInteractionSourceEffect,
    getLastInteractionTargetEffect: () => lastInteractionTargetEffect,
    getLastInteractionVisualState: () => lastInteractionVisualState,
    getLastInteractionRelationship: () => lastInteractionRelationship,
    getLastInteractionNetSourceStacks: () => lastInteractionNetSourceStacks,
    getLastInteractionNetTargetStacks: () => lastInteractionNetTargetStacks,
    getLastInteractionCanceledStacks: () => lastInteractionCanceledStacks,
  };
}
