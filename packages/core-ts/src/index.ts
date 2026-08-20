import {
  affinityExpressionAllowsEnvironmentMutation,
  affinityExpressionAllowsHazardArming,
  affinityExpressionIsPersistentField,
  getAffinityExpressionCount,
  getAffinityKindCount,
  getAffinityTargetTypeCount,
  getAffinityTargetVital,
  getDefaultAffinityTargetType,
  getOppositeAffinityKind,
  resolveAffinityRelationshipCode,
} from "./state/affinity.ts";
import { createEffectsPort, EffectKind } from "./ports/effects.ts";
import { createAffinityDamageRules } from "./rules/affinity-damage.ts";
import { createCombatRules } from "./rules/combat.ts";
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
import { createBudgetState, BudgetCategory } from "./state/budget.ts";
import { createCounterState } from "./state/counter.ts";
import { createEffectState } from "./state/effects.ts";
import {
  createMotivationState,
  getDefaultMotivationPattern,
  getMotivationDefaultFlagMask,
  getMotivationExclusiveGroup,
  getMotivationFamily,
  getMotivationFlagCount,
  getMotivationKindCount,
  getMotivationPatternCodeAt,
  getMotivationPatternCount,
  getMotivationTier,
  motivationKindsConflict,
  normalizeMotivationIntensity,
} from "./state/motivation.ts";
import { createWorldState } from "./state/world.ts";
import { ActionKind, validateAction, validateSeed, ValidationError } from "./validate/inputs.ts";

export { BudgetCategory } from "./state/budget.ts";
// Core owns the action codebook; runtime maps names onto these codes.
export { ActionKind, ValidationError, getValidationErrorName } from "./validate/inputs.ts";
// AM.10 — core owns the motivation exclusive groups, so it answers whether two
// kinds contradict each other. Imported above for the `core.*` surface but never
// re-exported, which is part of why it had no production caller: the Configurator
// could not reach it without holding a core instance.
export { getMotivationExclusiveGroup, getMotivationFamily, motivationKindsConflict } from "./state/motivation.ts";
// AM.9 — the profile axes, so behavior can branch on what a motivation IS rather
// than on its name. `MotivationFlag` travels with them: the flag mask is only
// meaningful against the bit names that define it.
export {
  MotivationFlag,
  ReasoningClass,
  getMotivationCognitionTier,
  getMotivationCombatTier,
  getMotivationDefaultFlagMask,
  getMotivationMobilityTier,
  getMotivationReasoningClass,
} from "./state/motivation.ts";
export * from "./affinity-readers.ts";
export * from "./motivation-readers.ts";
export * from "./mvp-movement.ts";

export const CORE_API_KEYS = [
  "addActorPlacement",
  "addMotivationEvaluationEntry",
  "advanceTick",
  "affinityExpressionAllowsEnvironmentMutation",
  "affinityExpressionAllowsHazardArming",
  "affinityExpressionIsPersistentField",
  "applyAction",
  "applyActorPlacements",
  "applyAffinityDamage",
  "applyAffinityDamageToHazard",
  "applyAffinityPullFromHazard",
  "applyAttack",
  "armStaticHazardAt",
  "clearActorPlacements",
  "clearAffinityField",
  "clearEffects",
  "clearMotivatedActorAffinity",
  "computeActorAffinityField",
  "computeAffinityField",
  "computeAffinityIntensity",
  "computeAffinityManaCost",
  "computeAffinityPotency",
  "computeAffinityRadius",
  "computeStaticHazardAffinityField",
  "configureGrid",
  "destroyBarrierAt",
  "disarmStaticHazardAt",
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
  "getMotivatedActorAffinityGrantCountByIndex",
  "getMotivatedActorAffinityGrantExpressionAt",
  "getMotivatedActorAffinityGrantKindAt",
  "getMotivatedActorAffinityGrantManaAt",
  "getMotivatedActorAffinityGrantManaMaxAt",
  "getMotivatedActorAffinityGrantManaRegenAt",
  "getMotivatedActorAffinityGrantStacksAt",
  "getMotivatedActorAffinityKindByIndex",
  "getMotivatedActorAffinityStacksByIndex",
  "getMotivatedActorAffinityStacksForKind",
  "getMotivatedActorCount",
  "getMotivatedActorIdByIndex",
  "getMotivatedActorMovementCostByIndex",
  "getMotivatedActorVitalCurrentByIndex",
  "getMotivatedActorVitalMaxByIndex",
  "getMotivatedActorVitalRegenByIndex",
  "getMotivatedActorXByIndex",
  "getMotivatedActorYByIndex",
  "getMotivationDefaultFlagMask",
  "getMotivationExclusiveGroup",
  "getMotivationFamily",
  "getMotivationFlagCount",
  "getMotivationKindCount",
  "getMotivationPatternCodeAt",
  "getMotivationPatternCount",
  "getMotivationTier",
  "getOppositeAffinityKind",
  "getResourceAffinityExpressionAt",
  "getResourceAffinityKindAt",
  "getResourceAffinityStacksAt",
  "getResourceDeltaAt",
  "getResourceManaAt",
  "getResourceManaRegenAt",
  "getResourceModeAt",
  "getResourceVitalKindAt",
  "getResourceVitalRegenAt",
  "getStaticHazardAffinityAt",
  "getStaticHazardCount",
  "getStaticHazardDurabilityAt",
  "getStaticHazardDurabilityMaxAt",
  "getStaticHazardDurabilityRegenAt",
  "getStaticHazardExpressionAt",
  "getStaticHazardManaMaxAt",
  "getStaticHazardManaRegenAt",
  "getStaticHazardManaReserveAt",
  "getStaticHazardStacksAt",
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
  "getVisibilityRadiusAt",
  "grantMotivatedActorAffinity",
  "hasResourceAt",
  "init",
  "loadMvpBarrierScenario",
  "loadMvpScenario",
  "loadTilesFromBuffer",
  "memory",
  "motivationKindsConflict",
  "normalizeMotivationIntensity",
  "placeAffinityResourceAt",
  "placeResourceAt",
  "prepareTileBuffer",
  "raiseBarrierAt",
  "removeResourceAt",
  "renderBaseCellChar",
  "renderCellChar",
  "resetMotivationEvaluation",
  "resolveAffinityInteraction",
  "resolveAffinityMergedStacks",
  "resolveAffinityRelationshipCode",
  "resolveAffinityStackCancellation",
  "resolveMotivatedActorAffinityInteraction",
  "setActionBudgetCost",
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
  "spendMotivatedActorAffinityMana",
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

// Core owns the budget category ids; the codebook lives with the budget state
// so runtime can import it rather than duplicating the numbering.
const DEFAULT_BUDGET_CATEGORY = BudgetCategory.Default;
const EFFECT_BUDGET_CATEGORY = BudgetCategory.Effects;
const REQUEST_DETAIL_MASK = 0xff;

function encodeRequestPayload(seq: number, detail: number): number {
  return (seq << 8) | (detail & REQUEST_DETAIL_MASK);
}

export function createCore(): Record<(typeof CORE_API_KEYS)[number], CoreExport> {
  const core = Object.fromEntries(
    CORE_API_KEYS.map((name) => [name, notImplemented(name)]),
  ) as Record<(typeof CORE_API_KEYS)[number], CoreExport>;
  const budget = createBudgetState();
  const counter = createCounterState();
  const effects = createEffectsPort();
  const effectState = createEffectState();
  const world = createWorldState();
  const affinitySpatial = createAffinitySpatialState({
    getMotivatedActorAffinityKindByIndex: (i: number) =>
      world.getMotivatedActorAffinityKindByIndex(i),
    getMotivatedActorAffinityExpressionByIndex: (i: number) =>
      world.getMotivatedActorAffinityExpressionByIndex(i),
    getMotivatedActorAffinityStacksByIndex: (i: number) =>
      world.getMotivatedActorAffinityStacksByIndex(i),
  });
  const motivation = createMotivationState();
  const move = createMoveRules(world);
  const combat = createCombatRules(world);
  const affinityDamage = createAffinityDamageRules(world);

  function emitBudgetEffects(category: number, spent: number): void {
    const cap = budget.getBudgetCap(category);
    if (cap >= 0 && spent === cap) {
      effects.pushEffect(EffectKind.LimitReached, spent);
    } else if (cap >= 0 && spent > cap) {
      effects.pushEffect(EffectKind.LimitViolated, spent);
    }
  }

  function validatePendingRequestAction(kind: number, value: number): number {
    if (kind !== ActionKind.FulfillRequest && kind !== ActionKind.DeferRequest) {
      return ValidationError.None;
    }
    const pending = effectState.getPendingRequest();
    if (pending === 0) {
      return ValidationError.MissingPendingRequest;
    }
    if (pending !== value) {
      return ValidationError.InvalidActionValue;
    }
    return ValidationError.None;
  }

  function chargeBudgetForAction(kind: number): void {
    const budgetCategory = kind === ActionKind.RequestExternalFact || kind === ActionKind.RequestSolver
      ? EFFECT_BUDGET_CATEGORY
      : DEFAULT_BUDGET_CATEGORY;
    // Cost is Allocator policy, injected via setActionBudgetCost; core only
    // enforces. Defaults to 1 unit per action when nothing injected.
    const budgetCost = budget.getActionCost(kind);
    const nextSpent = budget.chargeBudget(budgetCategory, budgetCost);
    emitBudgetEffects(budgetCategory, nextSpent);
  }

  function dispatchNonMoveAction(kind: number, value: number): void {
    if (kind === ActionKind.IncrementCounter) {
      const nextValue = counter.incrementCounter(value);
      effects.pushEffect(EffectKind.Log, nextValue);
      return;
    }
    if (kind === ActionKind.EmitLog) {
      effects.pushEffect(EffectKind.Log, value);
      return;
    }
    if (kind === ActionKind.EmitTelemetry) {
      effects.pushEffect(EffectKind.Telemetry, value);
      return;
    }
    if (kind === ActionKind.RequestExternalFact) {
      const seq = effectState.nextRequestSequence();
      effectState.setPendingRequest(seq);
      effects.pushEffect(EffectKind.NeedExternalFact, encodeRequestPayload(seq, value));
      return;
    }
    if (kind === ActionKind.RequestSolver) {
      const seq = effectState.nextRequestSequence();
      effects.pushEffect(EffectKind.SolverRequest, encodeRequestPayload(seq, value));
      return;
    }
    if (kind === ActionKind.FulfillRequest) {
      effectState.clearPendingRequest();
      effects.pushEffect(EffectKind.EffectFulfilled, value);
      return;
    }
    if (kind === ActionKind.DeferRequest) {
      effectState.clearPendingRequest();
      effects.pushEffect(EffectKind.EffectDeferred, value);
    }
  }

  function handleMoveAction(value: number): number {
    const action = move.decodeMove(value);
    const moveError = move.applyMove(action);
    if (moveError !== ValidationError.None) {
      if (moveError === ValidationError.BlockedByWall || moveError === ValidationError.ActorCollision) {
        effects.pushActorBlocked(action.actorId, action.toX, action.toY, moveError);
        return moveError;
      }
      effects.pushEffect(EffectKind.ActionRejected, moveError);
      return moveError;
    }
    effects.pushActorMoved(action.actorId, action.toX, action.toY);
    if (world.isActorAtExit()) {
      effects.pushEffect(EffectKind.LimitReached, action.tick);
    }
    return ValidationError.None;
  }

  /**
   * AM.1 — returns the ValidationError code (0 == None) instead of void.
   *
   * Rejection used to be reported ONLY by pushing ActionRejected into the effect
   * ring, which no caller read: the runtime's applyActionsToCore recorded every
   * move as accepted regardless of outcome, so a run in which core rejected
   * every move still reported every actor as having acted. The return value is
   * the caller-visible channel; the effect ring is unchanged and still carries
   * the same records for consumers that want them.
   *
   * Additive for existing callers — they ignore the return value.
   *
   * RULED 2026-08-18 (Plan.md §POST-AM/Z): Move never reaches chargeBudgetForAction
   * below, and that is intentional — stamina (AM.2b, rules/move.ts) is a move's real
   * cost, and the token budget was never meant to gate it a second time. See
   * tests/core-ts/action-budget-charging.test.mts for the proof and its control.
   */
  function applyAction(kind: number, value: number): number {
    if (kind === ActionKind.Move) {
      return handleMoveAction(value);
    }

    const actionError = validateAction(kind, value);
    if (actionError !== ValidationError.None) {
      effects.pushEffect(EffectKind.ActionRejected, actionError);
      return actionError;
    }

    const pendingRequestError = validatePendingRequestAction(kind, value);
    if (pendingRequestError !== ValidationError.None) {
      effects.pushEffect(EffectKind.ActionRejected, pendingRequestError);
      return pendingRequestError;
    }

    chargeBudgetForAction(kind);
    dispatchNonMoveAction(kind, value);
    return ValidationError.None;
  }

  core.memory = new ArrayBuffer(0);
  core.version = () => 1;
  core.getCounter = counter.getCounterValue as CoreFunction;
  core.setBudget = budget.setBudgetCap as CoreFunction;
  core.setActionBudgetCost = budget.setActionCost as CoreFunction;
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
  core.affinityExpressionAllowsHazardArming =
    affinityExpressionAllowsHazardArming as CoreFunction;
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
  core.normalizeMotivationIntensity = normalizeMotivationIntensity as CoreFunction;
  core.getMotivationDefaultFlagMask = getMotivationDefaultFlagMask as CoreFunction;
  core.getMotivationFlagCount = getMotivationFlagCount as CoreFunction;

  // Motivation state (per-instance)
  core.resetMotivationEvaluation = motivation.resetMotivationEvaluation as CoreFunction;
  core.addMotivationEvaluationEntry = motivation.addMotivationEvaluationEntry as CoreFunction;
  core.evaluateMotivations = motivation.evaluateMotivations as CoreFunction;
  core.getLastMotivationFlags = motivation.getLastMotivationFlags as CoreFunction;
  core.getLastMotivationMobilityTier = motivation.getLastMotivationMobilityTier as CoreFunction;
  core.getLastMotivationCombatTier = motivation.getLastMotivationCombatTier as CoreFunction;
  core.getLastMotivationCognitionTier = motivation.getLastMotivationCognitionTier as CoreFunction;
  core.getLastMotivationReasoningClass = motivation.getLastMotivationReasoningClass as CoreFunction;

  // World state (per-instance)
  core.configureGrid = world.configureGrid as CoreFunction;
  core.getMapWidth = world.getMapWidth as CoreFunction;
  core.getMapHeight = world.getMapHeight as CoreFunction;
  core.prepareTileBuffer = world.prepareTileBuffer as CoreFunction;
  core.loadTilesFromBuffer = world.loadTilesFromBuffer as CoreFunction;
  core.setTileAt = world.setTileAt as CoreFunction;
  core.setSpawnPosition = world.setSpawnPosition as CoreFunction;
  core.spawnActorAt = world.spawnActorAt as CoreFunction;
  core.loadMvpScenario = world.loadMvpScenario.bind(world) as CoreFunction;
  core.loadMvpBarrierScenario = world.loadMvpBarrierScenario.bind(world) as CoreFunction;
  core.renderBaseCellChar = world.renderBaseCellChar as CoreFunction;
  core.renderCellChar = world.renderCellChar.bind(world) as CoreFunction;
  core.getActorId = world.getActorId as CoreFunction;
  core.getActorKind = world.getActorKind as CoreFunction;
  core.getActorX = world.getActorX as CoreFunction;
  core.getActorY = world.getActorY as CoreFunction;
  core.getActorHp = world.getActorHp as CoreFunction;
  core.getActorMaxHp = world.getActorMaxHp as CoreFunction;
  core.getActorMovementCost = world.getActorMovementCost as CoreFunction;
  core.getActorActionCostMana = world.getActorActionCostMana as CoreFunction;
  core.getActorActionCostStamina = world.getActorActionCostStamina as CoreFunction;
  core.getActorVitalCurrent = world.getActorVitalCurrent as CoreFunction;
  core.getActorVitalMax = world.getActorVitalMax as CoreFunction;
  core.getActorVitalRegen = world.getActorVitalRegen as CoreFunction;
  core.setActorVital = world.setActorVital as CoreFunction;
  core.setActorMovementCost = world.setActorMovementCost as CoreFunction;
  core.setActorActionCostMana = world.setActorActionCostMana as CoreFunction;
  core.setActorActionCostStamina = world.setActorActionCostStamina as CoreFunction;
  core.setMotivatedActorVital = world.setMotivatedActorVital as CoreFunction;
  core.setMotivatedActorMovementCost = world.setMotivatedActorMovementCost as CoreFunction;
  core.setMotivatedActorActionCostMana = world.setMotivatedActorActionCostMana as CoreFunction;
  core.setMotivatedActorActionCostStamina = world.setMotivatedActorActionCostStamina as CoreFunction;
  core.validateActorVitals = world.validateActorVitals as CoreFunction;
  core.validateActorCapabilities = world.validateActorCapabilities as CoreFunction;
  core.clearActorPlacements = world.clearActorPlacements as CoreFunction;
  core.addActorPlacement = world.addActorPlacement as CoreFunction;
  core.getActorPlacementCount = world.getActorPlacementCount as CoreFunction;
  core.validateActorPlacement = world.validateActorPlacement as CoreFunction;
  core.applyActorPlacements = world.applyActorPlacements.bind(world) as CoreFunction;
  core.getMotivatedActorCount = world.getMotivatedActorCount as CoreFunction;
  core.getMotivatedActorIdByIndex = world.getMotivatedActorIdByIndex as CoreFunction;
  core.getMotivatedActorXByIndex = world.getMotivatedActorXByIndex as CoreFunction;
  core.getMotivatedActorYByIndex = world.getMotivatedActorYByIndex as CoreFunction;
  core.getMotivatedActorVitalCurrentByIndex = world.getMotivatedActorVitalCurrentByIndex as CoreFunction;
  core.getMotivatedActorVitalMaxByIndex = world.getMotivatedActorVitalMaxByIndex as CoreFunction;
  core.getMotivatedActorVitalRegenByIndex = world.getMotivatedActorVitalRegenByIndex as CoreFunction;
  core.getMotivatedActorMovementCostByIndex = world.getMotivatedActorMovementCostByIndex as CoreFunction;
  core.getMotivatedActorActionCostManaByIndex = world.getMotivatedActorActionCostManaByIndex as CoreFunction;
  core.getMotivatedActorActionCostStaminaByIndex = world.getMotivatedActorActionCostStaminaByIndex as CoreFunction;
  core.setActiveMotivatedActor = world.setActiveMotivatedActor as CoreFunction;
  core.advanceTick = world.advanceTick as CoreFunction;
  core.getCurrentTick = world.getCurrentTick as CoreFunction;
  core.getTileActorCount = world.getTileActorCount as CoreFunction;
  core.getTileActorIndex = world.getTileActorIndex as CoreFunction;
  core.getTileActorId = world.getTileActorId as CoreFunction;
  core.getTileActorKind = world.getTileActorKind as CoreFunction;
  core.getTileActorXByIndex = world.getTileActorXByIndex as CoreFunction;
  core.getTileActorYByIndex = world.getTileActorYByIndex as CoreFunction;
  core.getTileActorKindByIndex = world.getTileActorKindByIndex as CoreFunction;
  core.getTileActorIdByIndex = world.getTileActorIdByIndex as CoreFunction;
  core.getTileActorDurabilityByIndex = world.getTileActorDurabilityByIndex as CoreFunction;
  core.getTileActorDurability = world.getTileActorDurability.bind(world) as CoreFunction;
  core.raiseBarrierAt = world.raiseBarrierAt as CoreFunction;
  core.destroyBarrierAt = world.destroyBarrierAt as CoreFunction;
  core.armStaticHazardAt = world.armStaticHazardAt as CoreFunction;
  core.disarmStaticHazardAt = world.disarmStaticHazardAt as CoreFunction;
  core.getStaticHazardCount = world.getStaticHazardCount as CoreFunction;
  core.getStaticHazardAffinityAt = world.getStaticHazardAffinityAt as CoreFunction;
  core.getStaticHazardDurabilityAt = world.getStaticHazardDurabilityAt as CoreFunction;
  core.getStaticHazardDurabilityMaxAt = world.getStaticHazardDurabilityMaxAt as CoreFunction;
  core.getStaticHazardDurabilityRegenAt = world.getStaticHazardDurabilityRegenAt as CoreFunction;
  core.getStaticHazardExpressionAt = world.getStaticHazardExpressionAt as CoreFunction;
  core.getStaticHazardManaMaxAt = world.getStaticHazardManaMaxAt as CoreFunction;
  core.getStaticHazardManaRegenAt = world.getStaticHazardManaRegenAt as CoreFunction;
  core.getStaticHazardManaReserveAt = world.getStaticHazardManaReserveAt as CoreFunction;
  core.getStaticHazardStacksAt = world.getStaticHazardStacksAt as CoreFunction;
  core.clearAffinityField = world.clearAffinityField as CoreFunction;
  core.getAffinityFieldIntensityAt = world.getAffinityFieldIntensityAt as CoreFunction;
  core.getAffinityFieldStacksAt = world.getAffinityFieldStacksAt as CoreFunction;
  core.getVisibilityRadiusAt = world.getVisibilityRadiusAt as CoreFunction;
  core.getAffinityFieldExpressionAt = world.getAffinityFieldExpressionAt as CoreFunction;
  core.getAffinityFieldContributionCountAt = world.getAffinityFieldContributionCountAt as CoreFunction;
  core.computeStaticHazardAffinityField = world.computeStaticHazardAffinityField as CoreFunction;
  core.computeActorAffinityField = world.computeActorAffinityField as CoreFunction;
  core.computeAffinityField = world.computeAffinityField.bind(world) as CoreFunction;
  core.setMotivatedActorAffinity = world.setMotivatedActorAffinity as CoreFunction;
  // AM.8 — `clearMotivatedActorAffinity` existed on the world and was used
  // internally by rules/affinity-damage.ts, but was never published on the core
  // surface. A caller outside core could set an affinity and never remove one,
  // so a `typeof core.clearMotivatedActorAffinity === "function"` guard silently
  // did nothing — which is how an interaction that cancelled an affinity to zero
  // stacks left it standing.
  core.clearMotivatedActorAffinity = world.clearMotivatedActorAffinity as CoreFunction;
  core.getMotivatedActorAffinityKindByIndex = world.getMotivatedActorAffinityKindByIndex as CoreFunction;
  core.getMotivatedActorAffinityExpressionByIndex = world.getMotivatedActorAffinityExpressionByIndex as CoreFunction;
  core.getMotivatedActorAffinityStacksByIndex = world.getMotivatedActorAffinityStacksByIndex as CoreFunction;
  core.grantMotivatedActorAffinity = world.grantMotivatedActorAffinity as CoreFunction;
  core.spendMotivatedActorAffinityMana = world.spendMotivatedActorAffinityMana as CoreFunction;
  core.getMotivatedActorAffinityStacksForKind = world.getMotivatedActorAffinityStacksForKind as CoreFunction;
  core.getMotivatedActorAffinityGrantCountByIndex = world.getMotivatedActorAffinityGrantCountByIndex as CoreFunction;
  core.getMotivatedActorAffinityGrantKindAt = world.getMotivatedActorAffinityGrantKindAt as CoreFunction;
  core.getMotivatedActorAffinityGrantExpressionAt = world.getMotivatedActorAffinityGrantExpressionAt as CoreFunction;
  core.getMotivatedActorAffinityGrantStacksAt = world.getMotivatedActorAffinityGrantStacksAt as CoreFunction;
  core.getMotivatedActorAffinityGrantManaAt = world.getMotivatedActorAffinityGrantManaAt as CoreFunction;
  core.getMotivatedActorAffinityGrantManaMaxAt = world.getMotivatedActorAffinityGrantManaMaxAt as CoreFunction;
  core.getMotivatedActorAffinityGrantManaRegenAt = world.getMotivatedActorAffinityGrantManaRegenAt as CoreFunction;

  core.hasResourceAt = world.hasResourceAt.bind(world) as CoreFunction;
  core.placeResourceAt = world.placeResourceAt.bind(world) as CoreFunction;
  core.placeAffinityResourceAt = world.placeAffinityResourceAt.bind(world) as CoreFunction;
  core.removeResourceAt = world.removeResourceAt.bind(world) as CoreFunction;
  core.getResourceVitalKindAt = world.getResourceVitalKindAt as CoreFunction;
  core.getResourceDeltaAt = world.getResourceDeltaAt as CoreFunction;
  core.getResourceModeAt = world.getResourceModeAt as CoreFunction;
  core.getResourceAffinityKindAt = world.getResourceAffinityKindAt as CoreFunction;
  core.getResourceAffinityExpressionAt = world.getResourceAffinityExpressionAt as CoreFunction;
  core.getResourceAffinityStacksAt = world.getResourceAffinityStacksAt as CoreFunction;
  core.getResourceManaAt = world.getResourceManaAt as CoreFunction;
  core.getResourceManaRegenAt = world.getResourceManaRegenAt as CoreFunction;
  core.getResourceVitalRegenAt = world.getResourceVitalRegenAt as CoreFunction;

  core.init = ((seed: number) => {
    effects.clearEffects();
    budget.resetBudgets();
    effectState.resetEffectState();
    world.configureGrid(1, 1);
    const seedError = validateSeed(seed);
    if (seedError !== ValidationError.None) {
      effects.pushEffect(EffectKind.InitInvalid, seedError);
      return;
    }
    counter.resetCounter(seed);
  }) as CoreFunction;
  core.step = (() => { applyAction(ActionKind.IncrementCounter, 1); }) as CoreFunction;
  core.applyAction = applyAction as CoreFunction;
  core.applyAttack = combat.applyAttack as CoreFunction;
  core.applyAffinityDamage = affinityDamage.applyAffinityDamage as CoreFunction;
  core.applyAffinityDamageToHazard = affinityDamage.applyAffinityDamageToHazard as CoreFunction;
  core.applyAffinityPullFromHazard = affinityDamage.applyAffinityPullFromHazard as CoreFunction;

  return core;
}
