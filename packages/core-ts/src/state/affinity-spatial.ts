import {
  AffinityExpression,
  AffinityRelationship,
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

const AffinityInteractionVisualState = {
  ClashNeutral: 1,
  ClashOpposed: 2,
  Redirect: 3,
  Conflict: 4,
  Disruption: 5,
  Strike: 6,
  Vulnerability: 7,
  Backlash: 8,
  Siphon: 9,
  MutualDrain: 10,
  Absorb: 11,
  ToxicExposure: 12,
  Tug: 13,
  Rend: 14,
  Reinforcement: 15,
  ConflictZone: 16,
  Susceptible: 17,
  Resonance: 18,
  Corrosion: 19,
  Layered: 20,
  EmitField: 21,
} as const;

export interface AffinityInteractionCell {
  sourceEffect: number;
  targetEffect: number;
  visualState: number;
  usesStackCancellation: number;
}

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

function deriveSourceEffect(
  sourceExpression: number,
  targetExpression: number,
  relationship: number,
): number {
  if (relationship === AffinityRelationship.Same) {
    if (sourceExpression === AffinityExpression.Pull) {
      return targetExpression === AffinityExpression.Push
        ? AffinityEffect.None
        : AffinityEffect.ManaGain;
    }
    if (sourceExpression === AffinityExpression.Draw) {
      if (targetExpression === AffinityExpression.Push) return AffinityEffect.Damage;
      if (targetExpression === AffinityExpression.Pull) return AffinityEffect.ManaLoss;
      if (targetExpression === AffinityExpression.Emit) return AffinityEffect.ManaGain;
    }
    return AffinityEffect.None;
  }

  if (sourceExpression === AffinityExpression.Push) {
    if (targetExpression === AffinityExpression.Push) return AffinityEffect.ConditionalDamage;
    if (targetExpression === AffinityExpression.Pull) return AffinityEffect.Damage;
    if (targetExpression === AffinityExpression.Emit) return AffinityEffect.PotencyReduced;
    return AffinityEffect.None;
  }
  if (sourceExpression === AffinityExpression.Pull) return AffinityEffect.Damage;
  if (sourceExpression === AffinityExpression.Emit) {
    return targetExpression === AffinityExpression.Draw
      ? AffinityEffect.None
      : AffinityEffect.PotencyReduced;
  }
  if (targetExpression === AffinityExpression.Push) return AffinityEffect.AmplifiedDamage;
  if (targetExpression === AffinityExpression.Pull) return AffinityEffect.ManaLoss;
  return AffinityEffect.Damage;
}

function deriveTargetEffect(
  sourceExpression: number,
  targetExpression: number,
  relationship: number,
): number {
  if (relationship === AffinityRelationship.Same) {
    if (targetExpression === AffinityExpression.Push) {
      return AffinityEffect.None;
    }
    if (targetExpression === AffinityExpression.Pull) {
      if (sourceExpression === AffinityExpression.Pull) return AffinityEffect.ManaLoss;
      return sourceExpression === AffinityExpression.Push
        ? AffinityEffect.None
        : AffinityEffect.ManaGain;
    }
    if (targetExpression === AffinityExpression.Emit) return AffinityEffect.None;
    if (sourceExpression === AffinityExpression.Push) return AffinityEffect.Damage;
    if (sourceExpression === AffinityExpression.Pull) return AffinityEffect.ManaLoss;
    if (sourceExpression === AffinityExpression.Emit) return AffinityEffect.ManaGain;
    return AffinityEffect.None;
  }

  if (targetExpression === AffinityExpression.Push) {
    if (sourceExpression === AffinityExpression.Push) return AffinityEffect.ConditionalDamage;
    return sourceExpression === AffinityExpression.Emit
      ? AffinityEffect.PotencyReduced
      : AffinityEffect.None;
  }
  if (targetExpression === AffinityExpression.Pull) {
    return AffinityEffect.Damage;
  }
  if (targetExpression === AffinityExpression.Emit) {
    return sourceExpression === AffinityExpression.Draw
      ? AffinityEffect.None
      : AffinityEffect.PotencyReduced;
  }
  if (sourceExpression === AffinityExpression.Push) return AffinityEffect.AmplifiedDamage;
  if (sourceExpression === AffinityExpression.Pull) return AffinityEffect.ManaLoss;
  return AffinityEffect.Damage;
}

function deriveVisualState(
  sourceExpression: number,
  targetExpression: number,
  relationship: number,
): number {
  if (relationship === AffinityRelationship.Neutral) return AffinityInteractionVisualState.Layered;
  if (relationship === AffinityRelationship.Same) {
    if (sourceExpression === AffinityExpression.Push) {
      if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.ClashNeutral;
      if (targetExpression === AffinityExpression.Pull) return AffinityInteractionVisualState.Redirect;
      if (targetExpression === AffinityExpression.Emit) return AffinityInteractionVisualState.EmitField;
      return AffinityInteractionVisualState.Strike;
    }
    if (sourceExpression === AffinityExpression.Pull) {
      if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.Redirect;
      if (targetExpression === AffinityExpression.Pull) return AffinityInteractionVisualState.Siphon;
      if (targetExpression === AffinityExpression.Emit) return AffinityInteractionVisualState.Absorb;
      return AffinityInteractionVisualState.Tug;
    }
    if (sourceExpression === AffinityExpression.Emit) {
      if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.EmitField;
      if (targetExpression === AffinityExpression.Pull || targetExpression === AffinityExpression.Draw) {
        return AffinityInteractionVisualState.Absorb;
      }
      return AffinityInteractionVisualState.Reinforcement;
    }
    if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.Strike;
    if (targetExpression === AffinityExpression.Pull) return AffinityInteractionVisualState.Tug;
    if (targetExpression === AffinityExpression.Emit) return AffinityInteractionVisualState.Absorb;
    return AffinityInteractionVisualState.Resonance;
  }

  if (sourceExpression === AffinityExpression.Push) {
    if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.ClashOpposed;
    if (targetExpression === AffinityExpression.Pull) return AffinityInteractionVisualState.Conflict;
    if (targetExpression === AffinityExpression.Emit) return AffinityInteractionVisualState.Disruption;
    return AffinityInteractionVisualState.Vulnerability;
  }
  if (sourceExpression === AffinityExpression.Pull) {
    if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.Backlash;
    if (targetExpression === AffinityExpression.Pull) return AffinityInteractionVisualState.MutualDrain;
    if (targetExpression === AffinityExpression.Emit) return AffinityInteractionVisualState.ToxicExposure;
    return AffinityInteractionVisualState.Rend;
  }
  if (sourceExpression === AffinityExpression.Emit) {
    if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.Disruption;
    if (targetExpression === AffinityExpression.Pull) return AffinityInteractionVisualState.ToxicExposure;
    if (targetExpression === AffinityExpression.Emit) return AffinityInteractionVisualState.ConflictZone;
    return AffinityInteractionVisualState.Susceptible;
  }
  if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.Vulnerability;
  if (targetExpression === AffinityExpression.Pull) return AffinityInteractionVisualState.Rend;
  if (targetExpression === AffinityExpression.Emit) return AffinityInteractionVisualState.Susceptible;
  return AffinityInteractionVisualState.Corrosion;
}

export function deriveAffinityInteractionCell(
  sourceExpression: number,
  targetExpression: number,
  relationship: number,
): AffinityInteractionCell | null {
  if (!isValidCellArgs(sourceExpression, targetExpression, relationship)) return null;
  if (relationship === AffinityRelationship.Neutral) {
    return {
      sourceEffect: AffinityEffect.None,
      targetEffect: AffinityEffect.None,
      visualState: AffinityInteractionVisualState.Layered,
      usesStackCancellation: 0,
    };
  }

  const sourceEffect = deriveSourceEffect(sourceExpression, targetExpression, relationship);
  const targetEffect = deriveTargetEffect(sourceExpression, targetExpression, relationship);
  return {
    sourceEffect,
    targetEffect,
    visualState: deriveVisualState(sourceExpression, targetExpression, relationship),
    usesStackCancellation: relationship === AffinityRelationship.Opposite ? 1 : 0,
  };
}

export function getAffinityMatrixSourceEffect(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  return deriveAffinityInteractionCell(srcExpr, tgtExpr, relationship)?.sourceEffect ?? -1;
}

export function getAffinityMatrixTargetEffect(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  return deriveAffinityInteractionCell(srcExpr, tgtExpr, relationship)?.targetEffect ?? -1;
}

export function getAffinityMatrixVisualState(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  return deriveAffinityInteractionCell(srcExpr, tgtExpr, relationship)?.visualState ?? -1;
}

export function getAffinityMatrixUsesStackCancellation(
  srcExpr: number,
  tgtExpr: number,
  relationship: number,
): number {
  return deriveAffinityInteractionCell(srcExpr, tgtExpr, relationship)?.usesStackCancellation ?? -1;
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
    const cell = deriveAffinityInteractionCell(srcExpr, tgtExpr, relationship);
    if (cell === null) return 0;
    lastInteractionSourceEffect = cell.sourceEffect;
    lastInteractionTargetEffect = cell.targetEffect;
    lastInteractionVisualState = cell.visualState;

    if (cell.usesStackCancellation !== 0) {
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
