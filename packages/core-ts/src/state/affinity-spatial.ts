import {
  AffinityExpression,
  AffinityRelationship,
  isValidAffinityExpression,
  isValidAffinityKind,
  resolveAffinityRelationshipCode,
} from "./affinity.ts";
import { VitalKind } from "./vitals.ts";

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
      // A.2 ruling (maintainer, 2026-09-04): a DRAW converts same-kind energy however it
      // arrives, including a directed push. This cell used to be Damage, which made the
      // one expression built to absorb its own element the only one punished by it.
      if (targetExpression === AffinityExpression.Push) return AffinityEffect.ManaGain;
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
    // Same A.2 ruling, mirrored: the target here is the DRAW side.
    if (sourceExpression === AffinityExpression.Push) return AffinityEffect.ManaGain;
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
      // A.2: push into a same-kind draw is now a conversion, so it must not render as a
      // Strike. A visual that contradicts the effect is how a rules change reaches players
      // as a bug report instead of as a mechanic.
      return AffinityInteractionVisualState.Absorb;
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
    // Mirror of the push/draw cell above: the DRAW side is the source here, and it is
    // still the side doing the converting, so this renders as an Absorb too.
    if (targetExpression === AffinityExpression.Push) return AffinityInteractionVisualState.Absorb;
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


/**
 * How much harder an OPPOSITE field bites than an unrelated one. Opposition is the
 * reactive case throughout this module -- it is the only relationship the interaction
 * matrix marks `usesStackCancellation` -- so exposure to it costs more. The factor is
 * named rather than inlined because it is a gameplay tuning value, not a derivation.
 */
export const OPPOSITE_EXPOSURE_AMPLIFICATION = 2;

export interface ExposureQuery {
  /**
   * The effect the field already reports for this vital. Supplied rather than
   * recomputed: the FIELD owns magnitude and this function owns only the relationship.
   * Recomputing it here would make this a second authority on how strong a field is,
   * free to drift from the reader that produced it.
   */
  baseEffect: number;
  /** Which vital the field's own effect lands on. */
  vital: number;
  fieldKind: number;
  fieldExpression: number;
  observerKind: number;
  observerExpression: number;
}

export interface ExposureDelta {
  vital: number;
  effect: number;
}

/**
 * What a field at this tile actually does to THIS observer, as a set of vital deltas.
 *
 * A.2 RETURNS DELTAS, NOT ONE NUMBER, and that is the whole reason this shape changed.
 * The interaction matrix contains genuine CROSS-VITAL outcomes: a draw-expression actor
 * standing in a same-kind field converts it to mana instead of taking harm. A signature
 * returning a single number for a single vital could not express that -- it could only
 * have flipped the sign on the harmed vital, which is a different rule wearing the right
 * name. An empty array means the field does nothing to this observer.
 *
 * THE RELATIONSHIP RULE IS DERIVED, NOT INVENTED. Same-kind behaviour comes from the
 * 48-cell matrix via `deriveAffinityInteractionCell`, which F10M made a pure derivation
 * from stated rules. A second table of what resists what would be the F10 defect -- two
 * authorities for one concept -- this codebase already paid to remove once.
 *
 * NEUTRAL DELIBERATELY DOES NOT CONSULT THE MATRIX. The matrix answers what happens when
 * two affinities MEET, and for unrelated kinds that is correctly `None`: they do not
 * interact. Exposure is a different question -- a corrode field still corrodes an actor
 * with no relationship to it. Reading the matrix literally here would quietly make every
 * unrelated field harmless, a far larger regression than the asymmetry being fixed.
 */
export function resolveExposureVitalDeltas({
  baseEffect,
  vital,
  fieldKind,
  fieldExpression,
  observerKind,
  observerExpression,
}: ExposureQuery): ExposureDelta[] {
  const base = Number.isFinite(baseEffect) ? baseEffect : 0;
  if (base === 0) return [];

  // An observer with no affinity is affected exactly as before. Absent must mean
  // "unchanged" rather than "immune", or every ordinary actor becomes invulnerable.
  if (!isValidAffinityKind(observerKind)) return [{ vital, effect: base }];

  const relationship = resolveAffinityRelationshipCode(fieldKind, observerKind);
  if (relationship === AffinityRelationship.Neutral) return [{ vital, effect: base }];

  if (relationship === AffinityRelationship.Opposite) {
    // Only harm amplifies. Amplifying a benefit would reward standing in the one field
    // the actor is supposed to avoid.
    return [{ vital, effect: base < 0 ? base * OPPOSITE_EXPOSURE_AMPLIFICATION : base }];
  }

  // Same kind: the actor is the TARGET and the field is the SOURCE, so the matrix's
  // target effect is the one that applies to it.
  const cell = deriveAffinityInteractionCell(fieldExpression, observerExpression, relationship);
  if (!cell) return [{ vital, effect: base }];

  switch (cell.targetEffect) {
    case AffinityEffect.None:
      return [];
    case AffinityEffect.PotencyReduced:
      return [{ vital, effect: Math.trunc(base / 2) }];
    case AffinityEffect.AmplifiedDamage:
      return [{ vital, effect: base < 0 ? base * OPPOSITE_EXPOSURE_AMPLIFICATION : base }];
    case AffinityEffect.ManaGain:
      // The conversion the whole signature change exists for: the harm the field would
      // have done becomes mana at the same magnitude, and the harmed vital is spared.
      // Magnitude is |base| so a beneficial field cannot be turned into a mana penalty.
      return [{ vital: VitalKind.Mana, effect: Math.abs(base) }];
    case AffinityEffect.ManaLoss:
      return [{ vital: VitalKind.Mana, effect: -Math.abs(base) }];
    default:
      return [{ vital, effect: base }];
  }
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
