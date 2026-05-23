import {
  affinityExpressionAllowsEnvironmentMutation,
  affinityExpressionAllowsTrapArming,
  affinityExpressionIsPersistentField,
  isValidAffinityExpression,
  isValidAffinityKind,
  getAffinityExpressionCount,
  getAffinityKindCount,
  getAffinityTargetTypeCount,
  getAffinityTargetVital,
  getDefaultAffinityTargetType,
  getOppositeAffinityKind,
  resolveAffinityRelationshipCode,
} from "./state/affinity.ts";
import { createEffectsPort } from "./ports/effects.ts";
import { createMoveRules } from "./rules/move.ts";
import {
  computeAffinityIntensity,
  computeAffinityManaCost,
  computeAffinityPotency,
  computeAffinityRadius,
  createAffinitySpatialState,
  getAffinityEffectCount,
  getAffinityInteractionCellCount,
  getAffinityMatrixSourceEffect,
  getAffinityMatrixTargetEffect,
  getAffinityMatrixUsesStackCancellation,
  getAffinityMatrixVisualState,
  getAffinityVisualStateCount,
  resolveAffinityMergedStacks,
} from "./state/affinity-spatial.ts";
import { createBudgetState } from "./state/budget.ts";
import { createCounterState } from "./state/counter.ts";
import {
  createMotivationState,
  getDefaultMotivationPattern,
  getMotivationDefaultDesignCost,
  getMotivationDefaultFlagMask,
  getMotivationDefaultUnitCost,
  getMotivationExclusiveGroup,
  getMotivationFamily,
  getMotivationFlagCount,
  getMotivationKindCount,
  getMotivationPatternCodeAt,
  getMotivationPatternCount,
  getMotivationProfileCost,
  getMotivationTier,
  motivationKindsConflict,
  normalizeMotivationIntensity,
} from "./state/motivation.ts";

export const CORE_API_KEYS = [
  "addActorPlacement",
  "addMotivationCostEntry",
  "addMotivationEvaluationEntry",
  "advanceTick",
  "affinityExpressionAllowsEnvironmentMutation",
  "affinityExpressionAllowsTrapArming",
  "affinityExpressionIsPersistentField",
  "applyAction",
  "applyActorPlacements",
  "armStaticTrapAt",
  "clearActorPlacements",
  "clearAffinityField",
  "clearEffects",
  "computeActorAffinityField",
  "computeAffinityField",
  "computeAffinityIntensity",
  "computeAffinityManaCost",
  "computeAffinityPotency",
  "computeAffinityRadius",
  "computeStaticTrapAffinityField",
  "configureGrid",
  "destroyBarrierAt",
  "disarmStaticTrapAt",
  "evaluateMotivations",
  "getActorActionCostMana",
  "getActorActionCostStamina",
  "getActorHp",
  "getActorId",
  "getActorKind",
  "getActorMaxHp",
  "getActorMovementCost",
  "getActorPlacementCount",
  "getActorVitalCurrent",
  "getActorVitalMax",
  "getActorVitalRegen",
  "getActorX",
  "getActorY",
  "getAffinityEffectCount",
  "getAffinityExpressionCount",
  "getAffinityFieldContributionCountAt",
  "getAffinityFieldExpressionAt",
  "getAffinityFieldIntensityAt",
  "getAffinityFieldStacksAt",
  "getAffinityInteractionCellCount",
  "getAffinityKindCount",
  "getAffinityMatrixSourceEffect",
  "getAffinityMatrixTargetEffect",
  "getAffinityMatrixUsesStackCancellation",
  "getAffinityMatrixVisualState",
  "getAffinityTargetTypeCount",
  "getAffinityTargetVital",
  "getAffinityVisualStateCount",
  "getBudget",
  "getBudgetUsage",
  "getCounter",
  "getCurrentTick",
  "getDefaultAffinityTargetType",
  "getDefaultMotivationPattern",
  "getEffectActorId",
  "getEffectCount",
  "getEffectDelta",
  "getEffectKind",
  "getEffectReason",
  "getEffectValue",
  "getEffectX",
  "getEffectY",
  "getLastAffinityCanceledStacks",
  "getLastAffinityNetSourceStacks",
  "getLastAffinityNetTargetStacks",
  "getLastInteractionCanceledStacks",
  "getLastInteractionNetSourceStacks",
  "getLastInteractionNetTargetStacks",
  "getLastInteractionRelationship",
  "getLastInteractionSourceEffect",
  "getLastInteractionTargetEffect",
  "getLastInteractionVisualState",
  "getLastMotivationCognitionTier",
  "getLastMotivationCombatTier",
  "getLastMotivationFlags",
  "getLastMotivationMobilityTier",
  "getLastMotivationReasoningClass",
  "getMapHeight",
  "getMapWidth",
  "getMotivatedActorActionCostManaByIndex",
  "getMotivatedActorActionCostStaminaByIndex",
  "getMotivatedActorAffinityExpressionByIndex",
  "getMotivatedActorAffinityKindByIndex",
  "getMotivatedActorAffinityStacksByIndex",
  "getMotivatedActorCount",
  "getMotivatedActorIdByIndex",
  "getMotivatedActorMovementCostByIndex",
  "getMotivatedActorVitalCurrentByIndex",
  "getMotivatedActorVitalMaxByIndex",
  "getMotivatedActorVitalRegenByIndex",
  "getMotivatedActorXByIndex",
  "getMotivatedActorYByIndex",
  "getMotivationCostLineCount",
  "getMotivationCostLineFamily",
  "getMotivationCostLineKind",
  "getMotivationCostLineQuantity",
  "getMotivationCostLineSpend",
  "getMotivationCostLineUnitCost",
  "getMotivationCostTotal",
  "getMotivationDefaultDesignCost",
  "getMotivationDefaultFlagMask",
  "getMotivationDefaultUnitCost",
  "getMotivationExclusiveGroup",
  "getMotivationFamily",
  "getMotivationFlagCount",
  "getMotivationKindCount",
  "getMotivationPatternCodeAt",
  "getMotivationPatternCount",
  "getMotivationProfileCost",
  "getMotivationTier",
  "getOppositeAffinityKind",
  "getStaticTrapAffinityAt",
  "getStaticTrapCount",
  "getStaticTrapExpressionAt",
  "getStaticTrapManaReserveAt",
  "getStaticTrapStacksAt",
  "getTileActorCount",
  "getTileActorDurability",
  "getTileActorDurabilityByIndex",
  "getTileActorId",
  "getTileActorIdByIndex",
  "getTileActorIndex",
  "getTileActorKind",
  "getTileActorKindByIndex",
  "getTileActorXByIndex",
  "getTileActorYByIndex",
  "init",
  "loadMvpBarrierScenario",
  "loadMvpScenario",
  "loadTilesFromBuffer",
  "memory",
  "motivationKindsConflict",
  "normalizeMotivationIntensity",
  "prepareTileBuffer",
  "raiseBarrierAt",
  "renderBaseCellChar",
  "renderCellChar",
  "resetMotivationCostAccumulator",
  "resetMotivationEvaluation",
  "resolveAffinityInteraction",
  "resolveAffinityMergedStacks",
  "resolveAffinityRelationshipCode",
  "resolveAffinityStackCancellation",
  "resolveMotivatedActorAffinityInteraction",
  "setActiveMotivatedActor",
  "setActorActionCostMana",
  "setActorActionCostStamina",
  "setActorMovementCost",
  "setActorVital",
  "setBudget",
  "setMotivatedActorActionCostMana",
  "setMotivatedActorActionCostStamina",
  "setMotivatedActorAffinity",
  "setMotivatedActorMovementCost",
  "setMotivatedActorVital",
  "setMoveAction",
  "setSpawnPosition",
  "setTileAt",
  "spawnActorAt",
  "step",
  "validateActorCapabilities",
  "validateActorPlacement",
  "validateActorVitals",
  "version",
] as const;

type CoreFunction = (...args: unknown[]) => unknown;
type CoreExport = CoreFunction | ArrayBuffer;

function notImplemented(name: string): CoreFunction {
  return () => {
    throw new Error(`not implemented: ${name}`);
  };
}

export function createCore(): Record<(typeof CORE_API_KEYS)[number], CoreExport> {
  const core = Object.fromEntries(
    CORE_API_KEYS.map((name) => [name, notImplemented(name)]),
  ) as Record<(typeof CORE_API_KEYS)[number], CoreExport>;
  const budget = createBudgetState();
  const counter = createCounterState();
  const effects = createEffectsPort();
  const motivatedAffinityKind: number[] = [];
  const motivatedAffinityExpression: number[] = [];
  const motivatedAffinityStacks: number[] = [];
  let motivatedActorCount = 0;
  let actorX = -1;
  let actorY = -1;
  let currentTick = 0;

  const getMotivatedActorAffinityKindByIndex = (index: number): number =>
    motivatedAffinityKind[index] ?? 0;
  const getMotivatedActorAffinityExpressionByIndex = (index: number): number =>
    motivatedAffinityExpression[index] ?? 0;
  const getMotivatedActorAffinityStacksByIndex = (index: number): number =>
    motivatedAffinityStacks[index] ?? 0;
  const affinitySpatial = createAffinitySpatialState({
    getMotivatedActorAffinityKindByIndex,
    getMotivatedActorAffinityExpressionByIndex,
    getMotivatedActorAffinityStacksByIndex,
  });
  const motivation = createMotivationState();
  const move = createMoveRules({
    advanceTick: () => {
      currentTick += 1;
    },
    getActorId: () => 0,
    getActorMovementCost: () => -1,
    getActorVitalCurrent: () => 0,
    getActorVitalMax: () => 0,
    getActorVitalRegen: () => 0,
    getStaticTrapAffinityAt: () => 0,
    getStaticTrapExpressionAt: () => 0,
    getStaticTrapManaReserveAt: () => 0,
    getStaticTrapStacksAt: () => 0,
    getActorX: () => actorX,
    getActorY: () => actorY,
    getCurrentTick: () => currentTick,
    hasActor: () => false,
    hasResourceAt: () => 0,
    getResourceVitalKindAt: () => -1,
    getResourceDeltaAt: () => 0,
    getResourceModeAt: () => 0,
    removeResourceAt: () => undefined,
    isActorAtExit: () => false,
    isMotivatedOccupied: () => false,
    isWalkablePosition: () => false,
    setActorPosition: (x: number, y: number) => {
      actorX = x;
      actorY = y;
    },
    setActorVital: () => undefined,
    withinBounds: () => false,
  });

  core.memory = new ArrayBuffer(0);
  core.version = () => 1;
  core.getCounter = counter.getCounterValue as CoreFunction;
  core.setBudget = budget.setBudgetCap as CoreFunction;
  core.getBudget = budget.getBudgetCap as CoreFunction;
  core.getBudgetUsage = budget.getBudgetSpent as CoreFunction;
  core.getEffectCount = effects.getEffectCount as CoreFunction;
  core.getEffectKind = effects.getEffectKind as CoreFunction;
  core.getEffectValue = effects.getEffectValue as CoreFunction;
  core.getEffectActorId = effects.getEffectActorId as CoreFunction;
  core.getEffectX = effects.getEffectX as CoreFunction;
  core.getEffectY = effects.getEffectY as CoreFunction;
  core.getEffectReason = effects.getEffectReason as CoreFunction;
  core.getEffectDelta = effects.getEffectDelta as CoreFunction;
  core.clearEffects = effects.clearEffects as CoreFunction;
  core.getAffinityKindCount = getAffinityKindCount as CoreFunction;
  core.getAffinityExpressionCount = getAffinityExpressionCount as CoreFunction;
  core.getAffinityTargetTypeCount = getAffinityTargetTypeCount as CoreFunction;
  core.getOppositeAffinityKind = getOppositeAffinityKind as CoreFunction;
  core.resolveAffinityRelationshipCode =
    resolveAffinityRelationshipCode as CoreFunction;
  core.getAffinityTargetVital = getAffinityTargetVital as CoreFunction;
  core.getDefaultAffinityTargetType =
    getDefaultAffinityTargetType as CoreFunction;
  core.affinityExpressionAllowsEnvironmentMutation =
    affinityExpressionAllowsEnvironmentMutation as CoreFunction;
  core.affinityExpressionAllowsTrapArming =
    affinityExpressionAllowsTrapArming as CoreFunction;
  core.affinityExpressionIsPersistentField =
    affinityExpressionIsPersistentField as CoreFunction;
  core.computeAffinityRadius = computeAffinityRadius as CoreFunction;
  core.computeAffinityIntensity = computeAffinityIntensity as CoreFunction;
  core.computeAffinityPotency = computeAffinityPotency as CoreFunction;
  core.computeAffinityManaCost = computeAffinityManaCost as CoreFunction;
  core.resolveAffinityStackCancellation =
    affinitySpatial.resolveAffinityStackCancellation as CoreFunction;
  core.getLastAffinityCanceledStacks =
    affinitySpatial.getLastAffinityCanceledStacks as CoreFunction;
  core.getLastAffinityNetSourceStacks =
    affinitySpatial.getLastAffinityNetSourceStacks as CoreFunction;
  core.getLastAffinityNetTargetStacks =
    affinitySpatial.getLastAffinityNetTargetStacks as CoreFunction;
  core.resolveAffinityMergedStacks = resolveAffinityMergedStacks as CoreFunction;
  core.getAffinityInteractionCellCount =
    getAffinityInteractionCellCount as CoreFunction;
  core.getAffinityVisualStateCount = getAffinityVisualStateCount as CoreFunction;
  core.getAffinityEffectCount = getAffinityEffectCount as CoreFunction;
  core.getAffinityMatrixSourceEffect =
    getAffinityMatrixSourceEffect as CoreFunction;
  core.getAffinityMatrixTargetEffect =
    getAffinityMatrixTargetEffect as CoreFunction;
  core.getAffinityMatrixVisualState =
    getAffinityMatrixVisualState as CoreFunction;
  core.getAffinityMatrixUsesStackCancellation =
    getAffinityMatrixUsesStackCancellation as CoreFunction;
  core.resolveAffinityInteraction =
    affinitySpatial.resolveAffinityInteraction as CoreFunction;
  core.resolveMotivatedActorAffinityInteraction =
    affinitySpatial.resolveMotivatedActorAffinityInteraction as CoreFunction;
  core.getLastInteractionSourceEffect =
    affinitySpatial.getLastInteractionSourceEffect as CoreFunction;
  core.getLastInteractionTargetEffect =
    affinitySpatial.getLastInteractionTargetEffect as CoreFunction;
  core.getLastInteractionVisualState =
    affinitySpatial.getLastInteractionVisualState as CoreFunction;
  core.getLastInteractionRelationship =
    affinitySpatial.getLastInteractionRelationship as CoreFunction;
  core.getLastInteractionNetSourceStacks =
    affinitySpatial.getLastInteractionNetSourceStacks as CoreFunction;
  core.getLastInteractionNetTargetStacks =
    affinitySpatial.getLastInteractionNetTargetStacks as CoreFunction;
  core.getLastInteractionCanceledStacks =
    affinitySpatial.getLastInteractionCanceledStacks as CoreFunction;
  core.setMoveAction = move.setMoveAction as CoreFunction;

  // Motivation codebook (pure functions)
  core.getMotivationKindCount = getMotivationKindCount as CoreFunction;
  core.getMotivationFamily = getMotivationFamily as CoreFunction;
  core.getMotivationExclusiveGroup = getMotivationExclusiveGroup as CoreFunction;
  core.motivationKindsConflict = motivationKindsConflict as CoreFunction;
  core.getMotivationPatternCount = getMotivationPatternCount as CoreFunction;
  core.getMotivationPatternCodeAt = getMotivationPatternCodeAt as CoreFunction;
  core.getDefaultMotivationPattern = getDefaultMotivationPattern as CoreFunction;
  core.getMotivationTier = getMotivationTier as CoreFunction;
  core.getMotivationDefaultUnitCost = getMotivationDefaultUnitCost as CoreFunction;
  core.normalizeMotivationIntensity = normalizeMotivationIntensity as CoreFunction;
  core.getMotivationProfileCost = getMotivationProfileCost as CoreFunction;
  core.getMotivationDefaultDesignCost = getMotivationDefaultDesignCost as CoreFunction;
  core.getMotivationDefaultFlagMask = getMotivationDefaultFlagMask as CoreFunction;
  core.getMotivationFlagCount = getMotivationFlagCount as CoreFunction;

  // Motivation state (per-instance)
  core.resetMotivationCostAccumulator =
    motivation.resetMotivationCostAccumulator as CoreFunction;
  core.addMotivationCostEntry =
    motivation.addMotivationCostEntry as CoreFunction;
  core.getMotivationCostTotal =
    motivation.getMotivationCostTotal as CoreFunction;
  core.getMotivationCostLineCount =
    motivation.getMotivationCostLineCount as CoreFunction;
  core.getMotivationCostLineKind =
    motivation.getMotivationCostLineKind as CoreFunction;
  core.getMotivationCostLineFamily =
    motivation.getMotivationCostLineFamily as CoreFunction;
  core.getMotivationCostLineQuantity =
    motivation.getMotivationCostLineQuantity as CoreFunction;
  core.getMotivationCostLineUnitCost =
    motivation.getMotivationCostLineUnitCost as CoreFunction;
  core.getMotivationCostLineSpend =
    motivation.getMotivationCostLineSpend as CoreFunction;
  core.resetMotivationEvaluation =
    motivation.resetMotivationEvaluation as CoreFunction;
  core.addMotivationEvaluationEntry =
    motivation.addMotivationEvaluationEntry as CoreFunction;
  core.evaluateMotivations = motivation.evaluateMotivations as CoreFunction;
  core.getLastMotivationFlags =
    motivation.getLastMotivationFlags as CoreFunction;
  core.getLastMotivationMobilityTier =
    motivation.getLastMotivationMobilityTier as CoreFunction;
  core.getLastMotivationCombatTier =
    motivation.getLastMotivationCombatTier as CoreFunction;
  core.getLastMotivationCognitionTier =
    motivation.getLastMotivationCognitionTier as CoreFunction;
  core.getLastMotivationReasoningClass =
    motivation.getLastMotivationReasoningClass as CoreFunction;
  core.getMotivatedActorAffinityKindByIndex =
    getMotivatedActorAffinityKindByIndex as CoreFunction;
  core.getMotivatedActorAffinityExpressionByIndex =
    getMotivatedActorAffinityExpressionByIndex as CoreFunction;
  core.getMotivatedActorAffinityStacksByIndex =
    getMotivatedActorAffinityStacksByIndex as CoreFunction;
  core.getMotivatedActorCount = (() => motivatedActorCount) as CoreFunction;
  core.setMotivatedActorAffinity = ((
    index: number,
    kind: number,
    expression: number,
    stacks: number,
  ) => {
    if (index < 0) return;
    motivatedAffinityKind[index] = isValidAffinityKind(kind) ? kind : 0;
    motivatedAffinityExpression[index] = isValidAffinityExpression(expression)
      ? expression
      : 0;
    motivatedAffinityStacks[index] = stacks >= 1 ? stacks : 0;
    motivatedActorCount = Math.max(motivatedActorCount, index + 1);
  }) as CoreFunction;

  return core;
}
