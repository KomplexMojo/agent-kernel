export const AFFINITY_KIND_BY_CODE: Readonly<Record<number, string>> =
  Object.freeze({
    1: "fire",
    2: "water",
    3: "earth",
    4: "wind",
    5: "life",
    6: "decay",
    7: "corrode",
    8: "fortify",
    9: "light",
    10: "dark",
  });

export const AFFINITY_EXPRESSION_BY_CODE: Readonly<Record<number, string>> =
  Object.freeze({
    1: "push",
    2: "pull",
    3: "emit",
    4: "draw",
  });

export const AFFINITY_RELATIONSHIP_BY_CODE: Readonly<Record<number, string>> =
  Object.freeze({
    0: "same",
    1: "opposite",
    2: "neutral",
  });

export const AFFINITY_EFFECT_BY_CODE: Readonly<Record<number, string>> =
  Object.freeze({
    0: "none",
    1: "damage",
    2: "conditional_damage",
    3: "potency_reduced",
    4: "mana_gain",
    5: "mana_loss",
    6: "amplified_damage",
  });

export const AFFINITY_VISUAL_STATE_BY_CODE: Readonly<Record<number, string>> =
  Object.freeze({
    1: "clash_neutral",
    2: "clash_opposed",
    3: "redirect",
    4: "conflict",
    5: "disruption",
    6: "strike",
    7: "vulnerability",
    8: "backlash",
    9: "siphon",
    10: "mutual_drain",
    11: "absorb",
    12: "toxic_exposure",
    13: "tug",
    14: "rend",
    15: "reinforcement",
    16: "conflict_zone",
    17: "susceptible",
    18: "resonance",
    19: "corrosion",
    20: "layered",
    21: "emit_field",
  });

export interface AffinityFieldReaderCore {
  getAffinityFieldIntensityAt(x: number, y: number, kind: number): number;
  getAffinityFieldStacksAt(x: number, y: number, kind: number): number;
  getAffinityFieldExpressionAt(x: number, y: number, kind: number): number;
  getAffinityFieldContributionCountAt(
    x: number,
    y: number,
    kind: number,
  ): number;
}

export interface AffinityInteractionReaderCore {
  getLastInteractionSourceEffect(): number;
  getLastInteractionTargetEffect(): number;
  getLastInteractionVisualState(): number;
  getLastInteractionRelationship(): number;
  getLastInteractionNetSourceStacks(): number;
  getLastInteractionNetTargetStacks(): number;
  getLastInteractionCanceledStacks(): number;
}

export interface ActorAffinityReaderCore {
  getMotivatedActorAffinityKindByIndex(index: number): number;
  getMotivatedActorAffinityExpressionByIndex(index: number): number;
  getMotivatedActorAffinityStacksByIndex(index: number): number;
}

export interface AffinityFieldRead {
  intensity: number;
  stacks: number;
  expression: number;
  expressionName: string;
  contributionCount: number;
}

export interface AffinityInteractionResultRead {
  sourceEffect: number;
  sourceEffectName: string;
  targetEffect: number;
  targetEffectName: string;
  visualState: number;
  visualStateName: string;
  relationship: number;
  relationshipName: string;
  netSourceStacks: number;
  netTargetStacks: number;
  canceledStacks: number;
}

export interface ActorAffinityRead {
  kind: number;
  kindName: string;
  expression: number;
  expressionName: string;
  stacks: number;
}

export function readAffinityFieldAt(
  core: AffinityFieldReaderCore,
  x: number,
  y: number,
  kind: number,
): AffinityFieldRead {
  const intensity = core.getAffinityFieldIntensityAt(x, y, kind);
  const stacks = core.getAffinityFieldStacksAt(x, y, kind);
  const expression = core.getAffinityFieldExpressionAt(x, y, kind);
  const contributionCount = core.getAffinityFieldContributionCountAt(
    x,
    y,
    kind,
  );
  return {
    intensity,
    stacks,
    expression,
    expressionName: AFFINITY_EXPRESSION_BY_CODE[expression] ?? "unknown",
    contributionCount,
  };
}

export function readAffinityInteractionResult(
  core: AffinityInteractionReaderCore,
): AffinityInteractionResultRead {
  const sourceEffect = core.getLastInteractionSourceEffect();
  const targetEffect = core.getLastInteractionTargetEffect();
  const visualState = core.getLastInteractionVisualState();
  const relationship = core.getLastInteractionRelationship();
  return {
    sourceEffect,
    sourceEffectName: AFFINITY_EFFECT_BY_CODE[sourceEffect] ?? "unknown",
    targetEffect,
    targetEffectName: AFFINITY_EFFECT_BY_CODE[targetEffect] ?? "unknown",
    visualState,
    visualStateName: AFFINITY_VISUAL_STATE_BY_CODE[visualState] ?? "unknown",
    relationship,
    relationshipName: AFFINITY_RELATIONSHIP_BY_CODE[relationship] ?? "unknown",
    netSourceStacks: core.getLastInteractionNetSourceStacks(),
    netTargetStacks: core.getLastInteractionNetTargetStacks(),
    canceledStacks: core.getLastInteractionCanceledStacks(),
  };
}

export function readActorAffinity(
  core: ActorAffinityReaderCore,
  index: number,
): ActorAffinityRead | null {
  const kind = core.getMotivatedActorAffinityKindByIndex(index);
  if (kind === 0) return null;
  const expression = core.getMotivatedActorAffinityExpressionByIndex(index);
  const stacks = core.getMotivatedActorAffinityStacksByIndex(index);
  return {
    kind,
    kindName: AFFINITY_KIND_BY_CODE[kind] ?? "unknown",
    expression,
    expressionName: AFFINITY_EXPRESSION_BY_CODE[expression] ?? "unknown",
    stacks,
  };
}

