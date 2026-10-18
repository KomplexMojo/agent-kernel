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
import {
  createAffinitySpatialState,
  getAffinityEffectCount,
  getAffinityInteractionCellCount,
  getAffinityMatrixSourceEffect,
  getAffinityMatrixTargetEffect,
  getAffinityMatrixUsesStackCancellation,
  getAffinityMatrixVisualState,
  getAffinityVisualStateCount,
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
} from "./state/motivation.ts";
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
// Stage A — exposure is resolved against the OBSERVER, not per tile. Re-exported
// (not merely imported for the `core.*` surface) because the Actor persona needs it
// while ranking candidate destinations, and a persona holds no core instance.
export {
  OPPOSITE_EXPOSURE_AMPLIFICATION,
  resolveExposureVitalDeltas,
} from "./state/affinity-spatial.ts";
export * from "./affinity-readers.ts";
export * from "./motivation-readers.ts";

export const CORE_API_KEYS = [
  "addMotivationEvaluationEntry",
  "affinityExpressionAllowsEnvironmentMutation",
  "affinityExpressionAllowsHazardArming",
  "affinityExpressionIsPersistentField",
  "applyAction",
  "clearEffects",
  "evaluateMotivations",
  "getAffinityEffectCount",
  "getAffinityExpressionCount",
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
  "getMotivationDefaultFlagMask",
  "getMotivationExclusiveGroup",
  "getMotivationFamily",
  "getMotivationFlagCount",
  "getMotivationKindCount",
  "getMotivationPatternCodeAt",
  "getMotivationPatternCount",
  "getMotivationTier",
  "getOppositeAffinityKind",
  "init",
  "memory",
  "motivationKindsConflict",
  "resetMotivationEvaluation",
  "resolveAffinityInteraction",
  "resolveAffinityRelationshipCode",
  "resolveAffinityStackCancellation",
  "setActionBudgetCost",
  "setBudget",
  "step",
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
  const affinitySpatial = createAffinitySpatialState();
  const motivation = createMotivationState();

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
   * below, and that is intentional — stamina is a move's real cost, and the token
   * budget was never meant to gate it a second time.
   *
   * #227 — this core no longer holds actors, so it has no move to apply: actor
   * moves resolve against the actor registry (`rules/actor-turn.ts`). A Move
   * reaching here is refused, uncharged, rather than accepted as a no-op.
   */
  function applyAction(kind: number, value: number): number {
    if (kind === ActionKind.Move) {
      effects.pushEffect(EffectKind.ActionRejected, ValidationError.InvalidActionKind);
      return ValidationError.InvalidActionKind;
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
  core.resolveAffinityStackCancellation =
    affinitySpatial.resolveAffinityStackCancellation as CoreFunction;
  core.getLastAffinityCanceledStacks =
    affinitySpatial.getLastAffinityCanceledStacks as CoreFunction;
  core.getLastAffinityNetSourceStacks =
    affinitySpatial.getLastAffinityNetSourceStacks as CoreFunction;
  core.getLastAffinityNetTargetStacks =
    affinitySpatial.getLastAffinityNetTargetStacks as CoreFunction;
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

  // Motivation codebook (pure functions)
  core.getMotivationKindCount = getMotivationKindCount as CoreFunction;
  core.getMotivationFamily = getMotivationFamily as CoreFunction;
  core.getMotivationExclusiveGroup = getMotivationExclusiveGroup as CoreFunction;
  core.motivationKindsConflict = motivationKindsConflict as CoreFunction;
  core.getMotivationPatternCount = getMotivationPatternCount as CoreFunction;
  core.getMotivationPatternCodeAt = getMotivationPatternCodeAt as CoreFunction;
  core.getDefaultMotivationPattern = getDefaultMotivationPattern as CoreFunction;
  core.getMotivationTier = getMotivationTier as CoreFunction;
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

  core.init = ((seed: number) => {
    effects.clearEffects();
    budget.resetBudgets();
    effectState.resetEffectState();
    const seedError = validateSeed(seed);
    if (seedError !== ValidationError.None) {
      effects.pushEffect(EffectKind.InitInvalid, seedError);
      return;
    }
    counter.resetCounter(seed);
  }) as CoreFunction;
  core.step = (() => { applyAction(ActionKind.IncrementCounter, 1); }) as CoreFunction;
  core.applyAction = applyAction as CoreFunction;

  return core;
}
