// Entry points exported to WASM.
// Keep exports small and stable.
import {
  EffectKind,
  clearEffects,
  getEffectCount,
  getEffectKind,
  getEffectValue,
  getEffectActorId,
  getEffectX,
  getEffectY,
  getEffectReason,
  getEffectDelta,
  pushEffect,
  pushActorMoved,
  pushActorBlocked,
  pushDurabilityChanged,
} from "./ports/effects";
import { chargeBudget, getBudgetCap, resetBudgets, setBudgetCap, getBudgetSpent } from "./state/budget";
import { getCounterValue, incrementCounter, resetCounter } from "./state/counter";
import { clearPendingRequest, getPendingRequest, nextRequestSequence, resetEffectState, setPendingRequest } from "./state/effects";
import {
  loadMvpWorld,
  loadMvpBarrierWorld,
  renderBaseCell,
  renderCell,
  configureGrid as configureGridState,
  resetWorld,
  prepareTileBuffer as prepareTileBufferState,
  loadTilesFromBuffer as loadTilesFromBufferState,
  getMapWidth as worldMapWidth,
  getMapHeight as worldMapHeight,
  getActorX as getActorXState,
  getActorY as getActorYState,
  getActorKind as getActorKindState,
  getActorVitalCurrent as getActorVitalCurrentState,
  getActorVitalMax as getActorVitalMaxState,
  getActorVitalRegen as getActorVitalRegenState,
  getActorMovementCost as getActorMovementCostState,
  getActorActionCostMana as getActorActionCostManaState,
  getActorActionCostStamina as getActorActionCostStaminaState,
  setActorVital as setActorVitalState,
  setActorMovementCost as setActorMovementCostState,
  setActorActionCostMana as setActorActionCostManaState,
  setActorActionCostStamina as setActorActionCostStaminaState,
  validateActorVitals as validateActorVitalsState,
  validateActorCapabilities as validateActorCapabilitiesState,
  getTileActorKind as getTileActorKindState,
  getTileActorId as getTileActorIdState,
  getTileActorCount as getTileActorCountState,
  getTileActorIndex as getTileActorIndexState,
  getTileActorXByIndex as getTileActorXByIndexState,
  getTileActorYByIndex as getTileActorYByIndexState,
  getTileActorKindByIndex as getTileActorKindByIndexState,
  getTileActorIdByIndex as getTileActorIdByIndexState,
  getTileActorDurabilityByIndex as getTileActorDurabilityByIndexState,
  getTileActorDurability as getTileActorDurabilityState,
  isBarrierTile as isBarrierTileState,
  applyBarrierDurabilityDamage as applyBarrierDurabilityDamageState,
  raiseBarrierAt as raiseBarrierAtState,
  destroyBarrierAt as destroyBarrierAtState,
  armStaticTrapAt as armStaticTrapAtState,
  disarmStaticTrapAt as disarmStaticTrapAtState,
  getStaticTrapCount as getStaticTrapCountState,
  getStaticTrapAffinityAt as getStaticTrapAffinityAtState,
  getStaticTrapExpressionAt as getStaticTrapExpressionAtState,
  getStaticTrapStacksAt as getStaticTrapStacksAtState,
  getStaticTrapManaReserveAt as getStaticTrapManaReserveAtState,
  setSpawnPosition as setSpawnPositionState,
  clearActorPlacements as clearActorPlacementsState,
  addActorPlacement as addActorPlacementState,
  getActorPlacementCount as getActorPlacementCountState,
  applyActorPlacements as applyActorPlacementsState,
  setTileAt as setTileAtState,
  spawnActorAt as spawnActorAtState,
  validateActorPlacement as validateActorPlacementState,
  getCurrentTick as getCurrentTickValue,
  advanceTick as advanceTickState,
  getActorHp as getActorHpState,
  getActorMaxHp as getActorMaxHpState,
  getActorId as getActorIdState,
  getMotivatedActorCount as getMotivatedActorCountState,
  getMotivatedActorIdByIndex as getMotivatedActorIdByIndexState,
  getMotivatedActorXByIndex as getMotivatedActorXByIndexState,
  getMotivatedActorYByIndex as getMotivatedActorYByIndexState,
  getMotivatedActorVitalCurrentByIndex as getMotivatedActorVitalCurrentByIndexState,
  getMotivatedActorVitalMaxByIndex as getMotivatedActorVitalMaxByIndexState,
  getMotivatedActorVitalRegenByIndex as getMotivatedActorVitalRegenByIndexState,
  getMotivatedActorMovementCostByIndex as getMotivatedActorMovementCostByIndexState,
  getMotivatedActorActionCostManaByIndex as getMotivatedActorActionCostManaByIndexState,
  getMotivatedActorActionCostStaminaByIndex as getMotivatedActorActionCostStaminaByIndexState,
  setActiveMotivatedActor as setActiveMotivatedActorState,
  setMotivatedActorVital as setMotivatedActorVitalState,
  setMotivatedActorMovementCost as setMotivatedActorMovementCostState,
  setMotivatedActorActionCostMana as setMotivatedActorActionCostManaState,
  setMotivatedActorActionCostStamina as setMotivatedActorActionCostStaminaState,
  placeResourceAt as placeResourceAtState,
  removeResourceAt as removeResourceAtState,
  hasResourceAt as hasResourceAtState,
  getResourceVitalKindAt as getResourceVitalKindAtState,
  getResourceDeltaAt as getResourceDeltaAtState,
  getResourceModeAt as getResourceModeAtState,
  getResourceCount as getResourceCountState,
  clearAffinityField as clearAffinityFieldState,
  computeStaticTrapAffinityField as computeStaticTrapAffinityFieldState,
  getAffinityFieldIntensityAt as getAffinityFieldIntensityAtState,
  getAffinityFieldStacksAt as getAffinityFieldStacksAtState,
  getAffinityFieldExpressionAt as getAffinityFieldExpressionAtState,
  getAffinityFieldContributionCountAt as getAffinityFieldContributionCountAtState,
  setMotivatedActorAffinity as setMotivatedActorAffinityState,
  getMotivatedActorAffinityKindByIndex as getMotivatedActorAffinityKindByIndexState,
  getMotivatedActorAffinityExpressionByIndex as getMotivatedActorAffinityExpressionByIndexState,
  getMotivatedActorAffinityStacksByIndex as getMotivatedActorAffinityStacksByIndexState,
  computeActorAffinityField as computeActorAffinityFieldState,
  computeAffinityField as computeAffinityFieldState,
} from "./state/world";
import { applyMove, decodeMove, MoveAction, reachedExitAfterMove, setMoveAction as setMoveActionState } from "./rules/move";
import { ActionKind, ValidationError, validateAction, validateSeed } from "./validate/inputs";
import {
  getAffinityKindCount as getAffinityKindCountState,
  getAffinityExpressionCount as getAffinityExpressionCountState,
  getAffinityTargetTypeCount as getAffinityTargetTypeCountState,
  getOppositeAffinityKind as getOppositeAffinityKindState,
  resolveAffinityRelationshipCode as resolveAffinityRelationshipCodeState,
  getAffinityTargetVital as getAffinityTargetVitalState,
  getDefaultAffinityTargetType as getDefaultAffinityTargetTypeState,
  affinityExpressionAllowsEnvironmentMutation as affinityExpressionAllowsEnvironmentMutationState,
  affinityExpressionAllowsTrapArming as affinityExpressionAllowsTrapArmingState,
  affinityExpressionIsPersistentField as affinityExpressionIsPersistentFieldState,
} from "./state/affinity";
import {
  getMotivationKindCount as getMotivationKindCountState,
  getMotivationFamily as getMotivationFamilyState,
  getMotivationExclusiveGroup as getMotivationExclusiveGroupState,
  motivationKindsConflict as motivationKindsConflictState,
  getMotivationPatternCount as getMotivationPatternCountState,
  getMotivationPatternCodeAt as getMotivationPatternCodeAtState,
  getDefaultMotivationPattern as getDefaultMotivationPatternState,
  normalizeMotivationIntensity as normalizeMotivationIntensityState,
  getMotivationTier as getMotivationTierState,
  getMotivationDefaultUnitCost as getMotivationDefaultUnitCostState,
  resetMotivationCostAccumulator as resetMotivationCostAccumulatorState,
  addMotivationCostEntry as addMotivationCostEntryState,
  getMotivationCostTotal as getMotivationCostTotalState,
  getMotivationCostLineCount as getMotivationCostLineCountState,
  getMotivationCostLineKind as getMotivationCostLineKindState,
  getMotivationCostLineFamily as getMotivationCostLineFamilyState,
  getMotivationCostLineQuantity as getMotivationCostLineQuantityState,
  getMotivationCostLineUnitCost as getMotivationCostLineUnitCostState,
  getMotivationCostLineSpend as getMotivationCostLineSpendState,
  getMotivationFlagCount as getMotivationFlagCountState,
  getMotivationProfileCost as getMotivationProfileCostState,
  getMotivationDefaultDesignCost as getMotivationDefaultDesignCostState,
  getMotivationDefaultFlagMask as getMotivationDefaultFlagMaskState,
  resetMotivationEvaluation as resetMotivationEvaluationState,
  addMotivationEvaluationEntry as addMotivationEvaluationEntryState,
  evaluateMotivations as evaluateMotivationsState,
  getLastMotivationFlags as getLastMotivationFlagsState,
  getLastMotivationMobilityTier as getLastMotivationMobilityTierState,
  getLastMotivationCombatTier as getLastMotivationCombatTierState,
  getLastMotivationCognitionTier as getLastMotivationCognitionTierState,
  getLastMotivationReasoningClass as getLastMotivationReasoningClassState,
} from "./state/motivation";
import {
  computeAffinityRadius as computeAffinityRadiusState,
  computeAffinityIntensity as computeAffinityIntensityState,
  computeAffinityPotency as computeAffinityPotencyState,
  computeAffinityManaCost as computeAffinityManaCostState,
  resolveAffinityStackCancellation as resolveAffinityStackCancellationState,
  getLastAffinityCanceledStacks as getLastAffinityCanceledStacksState,
  getLastAffinityNetSourceStacks as getLastAffinityNetSourceStacksState,
  getLastAffinityNetTargetStacks as getLastAffinityNetTargetStacksState,
  resolveAffinityMergedStacks as resolveAffinityMergedStacksState,
  getAffinityInteractionCellCount as getAffinityInteractionCellCountState,
  getAffinityMatrixSourceEffect as getAffinityMatrixSourceEffectState,
  getAffinityMatrixTargetEffect as getAffinityMatrixTargetEffectState,
  getAffinityMatrixVisualState as getAffinityMatrixVisualStateState,
  getAffinityMatrixUsesStackCancellation as getAffinityMatrixUsesStackCancellationState,
  getAffinityVisualStateCount as getAffinityVisualStateCountState,
  getAffinityEffectCount as getAffinityEffectCountState,
  resolveAffinityInteraction as resolveAffinityInteractionState,
  resolveMotivatedActorAffinityInteraction as resolveMotivatedActorAffinityInteractionState,
  getLastInteractionSourceEffect as getLastInteractionSourceEffectState,
  getLastInteractionTargetEffect as getLastInteractionTargetEffectState,
  getLastInteractionVisualState as getLastInteractionVisualStateState,
  getLastInteractionRelationship as getLastInteractionRelationshipState,
  getLastInteractionNetSourceStacks as getLastInteractionNetSourceStacksState,
  getLastInteractionNetTargetStacks as getLastInteractionNetTargetStacksState,
  getLastInteractionCanceledStacks as getLastInteractionCanceledStacksState,
} from "./state/affinity-spatial";

const DEFAULT_BUDGET_CATEGORY: i32 = 0;
const EFFECT_BUDGET_CATEGORY: i32 = 1;
const REQUEST_DETAIL_MASK: i32 = 0xff;
const DURABILITY_DAMAGE: i32 = 1;

function encodeRequestPayload(seq: i32, detail: i32): i32 {
  return (seq << 8) | (detail & REQUEST_DETAIL_MASK);
}

export function version(): i32 {
  return 1;
}

export function init(seed: i32): void {
  clearEffects();
  resetBudgets();
  resetEffectState();
  resetWorld();
  const seedError = validateSeed(seed);
  if (seedError != ValidationError.None) {
    pushEffect(EffectKind.InitInvalid, seedError);
    return;
  }
  resetCounter(seed);
}

export function step(): void {
  applyAction(ActionKind.IncrementCounter, 1);
}

function emitBudgetEffects(category: i32, spent: i32): void {
  const cap = getBudgetCap(category);
  if (cap >= 0 && spent == cap) {
    pushEffect(EffectKind.LimitReached, spent);
  } else if (cap >= 0 && spent > cap) {
    pushEffect(EffectKind.LimitViolated, spent);
  }
}

function handleMoveAction(move: MoveAction): void {
  const moveError = applyMove(move);
  if (moveError != ValidationError.None) {
    if (moveError == ValidationError.BlockedByWall || moveError == ValidationError.ActorCollision) {
      pushActorBlocked(move.actorId, move.toX, move.toY, moveError);
      if (moveError == ValidationError.BlockedByWall && isBarrierTileState(move.toX, move.toY)) {
        const delta = applyBarrierDurabilityDamageState(move.toX, move.toY, DURABILITY_DAMAGE);
        const tileActorId = getTileActorIdState(move.toX, move.toY);
        pushDurabilityChanged(tileActorId, delta);
      }
      return;
    }
    pushEffect(EffectKind.ActionRejected, moveError);
    return;
  }
  pushActorMoved(move.actorId, move.toX, move.toY);
  if (reachedExitAfterMove()) {
    pushEffect(EffectKind.LimitReached, move.tick);
  }
}

function validatePendingRequestAction(kind: i32, value: i32): ValidationError {
  if (kind != ActionKind.FulfillRequest && kind != ActionKind.DeferRequest) {
    return ValidationError.None;
  }
  const pending = getPendingRequest();
  if (pending == 0) {
    return ValidationError.MissingPendingRequest;
  }
  if (pending != value) {
    return ValidationError.InvalidActionValue;
  }
  return ValidationError.None;
}

function chargeBudgetForAction(kind: i32): void {
  const budgetCategory = kind == ActionKind.RequestExternalFact || kind == ActionKind.RequestSolver
    ? EFFECT_BUDGET_CATEGORY
    : DEFAULT_BUDGET_CATEGORY;
  const budgetCost = kind == ActionKind.RequestSolver ? 2 : 1;
  const nextSpent = chargeBudget(budgetCategory, budgetCost);
  emitBudgetEffects(budgetCategory, nextSpent);
}

function dispatchNonMoveAction(kind: i32, value: i32): void {
  if (kind == ActionKind.IncrementCounter) {
    const nextValue = incrementCounter(value);
    pushEffect(EffectKind.Log, nextValue);
    return;
  }

  if (kind == ActionKind.EmitLog) {
    pushEffect(EffectKind.Log, value);
    return;
  }

  if (kind == ActionKind.EmitTelemetry) {
    pushEffect(EffectKind.Telemetry, value);
    return;
  }

  if (kind == ActionKind.RequestExternalFact) {
    const seq = nextRequestSequence();
    setPendingRequest(seq);
    const payload = encodeRequestPayload(seq, value);
    pushEffect(EffectKind.NeedExternalFact, payload);
    return;
  }

  if (kind == ActionKind.RequestSolver) {
    const seq = nextRequestSequence();
    const payload = encodeRequestPayload(seq, value);
    pushEffect(EffectKind.SolverRequest, payload);
    return;
  }

  if (kind == ActionKind.FulfillRequest) {
    clearPendingRequest();
    pushEffect(EffectKind.EffectFulfilled, value);
    return;
  }

  if (kind == ActionKind.DeferRequest) {
    clearPendingRequest();
    pushEffect(EffectKind.EffectDeferred, value);
  }
}

export function applyAction(kind: i32, value: i32): void {
  if (kind == ActionKind.Move) {
    const move = decodeMove(value);
    handleMoveAction(move);
    return;
  }

  const actionError = validateAction(kind, value);
  if (actionError != ValidationError.None) {
    pushEffect(EffectKind.ActionRejected, actionError);
    return;
  }

  const pendingRequestError = validatePendingRequestAction(kind, value);
  if (pendingRequestError != ValidationError.None) {
    pushEffect(EffectKind.ActionRejected, pendingRequestError);
    return;
  }

  chargeBudgetForAction(kind);
  dispatchNonMoveAction(kind, value);
}

export function getCounter(): i32 {
  return getCounterValue();
}

export function setBudget(category: i32, cap: i32): void {
  setBudgetCap(category, cap);
}

export function getBudget(category: i32): i32 {
  return getBudgetCap(category);
}

export function getBudgetUsage(category: i32): i32 {
  return getBudgetSpent(category);
}

export { clearEffects, getEffectCount, getEffectKind, getEffectValue };
export {
  getEffectActorId,
  getEffectX,
  getEffectY,
  getEffectReason,
  getEffectDelta,
};

// Movement-specific helpers for rendering and inspection.
export function loadMvpScenario(): void {
  loadMvpWorld();
}

export function loadMvpBarrierScenario(): void {
  loadMvpBarrierWorld();
}

export function setMoveAction(
  actorId: i32,
  fromX: i32,
  fromY: i32,
  toX: i32,
  toY: i32,
  direction: i32,
  tick: i32,
): void {
  setMoveActionState(actorId, fromX, fromY, toX, toY, direction, tick);
}

export function configureGrid(width: i32, height: i32): i32 {
  const error = configureGridState(width, height);
  if (error != ValidationError.None) {
    pushEffect(EffectKind.ConfigInvalid, error);
  }
  return error;
}

export function prepareTileBuffer(length: i32): usize {
  return prepareTileBufferState(length);
}

export function loadTilesFromBuffer(length: i32): i32 {
  const error = loadTilesFromBufferState(length);
  if (error != ValidationError.None) {
    pushEffect(EffectKind.ConfigInvalid, error);
  }
  return error;
}

export function setTileAt(x: i32, y: i32, tile: i32): void {
  setTileAtState(x, y, tile);
}

export function spawnActorAt(x: i32, y: i32): void {
  spawnActorAtState(x, y);
}

export function setSpawnPosition(x: i32, y: i32): void {
  setSpawnPositionState(x, y);
}

export function clearActorPlacements(): void {
  clearActorPlacementsState();
}

export function addActorPlacement(id: i32, x: i32, y: i32): void {
  addActorPlacementState(id, x, y);
}

export function getActorPlacementCount(): i32 {
  return getActorPlacementCountState();
}

export function validateActorPlacement(): i32 {
  const error = validateActorPlacementState();
  if (error != ValidationError.None) {
    pushEffect(EffectKind.ConfigInvalid, error);
  }
  return error;
}

export function applyActorPlacements(): i32 {
  const error = applyActorPlacementsState();
  if (error != ValidationError.None) {
    pushEffect(EffectKind.ConfigInvalid, error);
  }
  return error;
}

export function getMapWidth(): i32 {
  return worldMapWidth();
}

export function getMapHeight(): i32 {
  return worldMapHeight();
}

export function getActorX(): i32 {
  return getActorXState();
}

export function getActorY(): i32 {
  return getActorYState();
}

export function getActorHp(): i32 {
  return getActorHpState();
}

export function getActorMaxHp(): i32 {
  return getActorMaxHpState();
}

export function getActorId(): i32 {
  return getActorIdState();
}

export function getActorKind(): i32 {
  return getActorKindState();
}

export function getTileActorKind(x: i32, y: i32): i32 {
  return getTileActorKindState(x, y);
}

export function getTileActorId(x: i32, y: i32): i32 {
  return getTileActorIdState(x, y);
}

export function getTileActorCount(): i32 {
  return getTileActorCountState();
}

export function getTileActorIndex(x: i32, y: i32): i32 {
  return getTileActorIndexState(x, y);
}

export function getTileActorXByIndex(index: i32): i32 {
  return getTileActorXByIndexState(index);
}

export function getTileActorYByIndex(index: i32): i32 {
  return getTileActorYByIndexState(index);
}

export function getTileActorKindByIndex(index: i32): i32 {
  return getTileActorKindByIndexState(index);
}

export function getTileActorIdByIndex(index: i32): i32 {
  return getTileActorIdByIndexState(index);
}

export function getTileActorDurabilityByIndex(index: i32): i32 {
  return getTileActorDurabilityByIndexState(index);
}

export function getTileActorDurability(x: i32, y: i32): i32 {
  return getTileActorDurabilityState(x, y);
}

export function raiseBarrierAt(x: i32, y: i32): i32 {
  return raiseBarrierAtState(x, y);
}

export function destroyBarrierAt(x: i32, y: i32): i32 {
  return destroyBarrierAtState(x, y);
}

export function armStaticTrapAt(
  x: i32,
  y: i32,
  affinityKind: i32,
  expression: i32,
  stacks: i32,
  manaReserve: i32,
): i32 {
  return armStaticTrapAtState(x, y, affinityKind, expression, stacks, manaReserve);
}

export function disarmStaticTrapAt(x: i32, y: i32): i32 {
  return disarmStaticTrapAtState(x, y);
}

export function getStaticTrapCount(): i32 {
  return getStaticTrapCountState();
}

export function getStaticTrapAffinityAt(x: i32, y: i32): i32 {
  return getStaticTrapAffinityAtState(x, y);
}

export function getStaticTrapExpressionAt(x: i32, y: i32): i32 {
  return getStaticTrapExpressionAtState(x, y);
}

export function getStaticTrapStacksAt(x: i32, y: i32): i32 {
  return getStaticTrapStacksAtState(x, y);
}

export function getStaticTrapManaReserveAt(x: i32, y: i32): i32 {
  return getStaticTrapManaReserveAtState(x, y);
}

export function getCurrentTick(): i32 {
  return getCurrentTickValue();
}

export function advanceTick(): void {
  advanceTickState();
}

export function getActorVitalCurrent(kind: i32): i32 {
  return getActorVitalCurrentState(kind);
}

export function getActorVitalMax(kind: i32): i32 {
  return getActorVitalMaxState(kind);
}

export function getActorVitalRegen(kind: i32): i32 {
  return getActorVitalRegenState(kind);
}

export function getActorMovementCost(): i32 {
  return getActorMovementCostState();
}

export function getActorActionCostMana(): i32 {
  return getActorActionCostManaState();
}

export function getActorActionCostStamina(): i32 {
  return getActorActionCostStaminaState();
}

export function setActorVital(kind: i32, current: i32, max: i32, regen: i32): void {
  setActorVitalState(kind, current, max, regen);
}

export function setActorMovementCost(value: i32): void {
  setActorMovementCostState(value);
}

export function setActorActionCostMana(value: i32): void {
  setActorActionCostManaState(value);
}

export function setActorActionCostStamina(value: i32): void {
  setActorActionCostStaminaState(value);
}

export function setMotivatedActorVital(index: i32, kind: i32, current: i32, max: i32, regen: i32): void {
  setMotivatedActorVitalState(index, kind, current, max, regen);
}

export function setMotivatedActorMovementCost(index: i32, value: i32): void {
  setMotivatedActorMovementCostState(index, value);
}

export function setMotivatedActorActionCostMana(index: i32, value: i32): void {
  setMotivatedActorActionCostManaState(index, value);
}

export function setMotivatedActorActionCostStamina(index: i32, value: i32): void {
  setMotivatedActorActionCostStaminaState(index, value);
}

export function validateActorVitals(): i32 {
  return validateActorVitalsState();
}

export function validateActorCapabilities(): i32 {
  return validateActorCapabilitiesState();
}

export function renderCellChar(x: i32, y: i32): i32 {
  return renderCell(x, y);
}

export function renderBaseCellChar(x: i32, y: i32): i32 {
  return renderBaseCell(x, y);
}

export function getMotivatedActorCount(): i32 {
  return getMotivatedActorCountState();
}

export function getMotivatedActorIdByIndex(index: i32): i32 {
  return getMotivatedActorIdByIndexState(index);
}

export function getMotivatedActorXByIndex(index: i32): i32 {
  return getMotivatedActorXByIndexState(index);
}

export function getMotivatedActorYByIndex(index: i32): i32 {
  return getMotivatedActorYByIndexState(index);
}

export function getMotivatedActorVitalCurrentByIndex(index: i32, kind: i32): i32 {
  return getMotivatedActorVitalCurrentByIndexState(index, kind);
}

export function getMotivatedActorVitalMaxByIndex(index: i32, kind: i32): i32 {
  return getMotivatedActorVitalMaxByIndexState(index, kind);
}

export function getMotivatedActorVitalRegenByIndex(index: i32, kind: i32): i32 {
  return getMotivatedActorVitalRegenByIndexState(index, kind);
}

export function getMotivatedActorMovementCostByIndex(index: i32): i32 {
  return getMotivatedActorMovementCostByIndexState(index);
}

export function getMotivatedActorActionCostManaByIndex(index: i32): i32 {
  return getMotivatedActorActionCostManaByIndexState(index);
}

export function getMotivatedActorActionCostStaminaByIndex(index: i32): i32 {
  return getMotivatedActorActionCostStaminaByIndexState(index);
}

export function setActiveMotivatedActor(actorId: i32): i32 {
  return setActiveMotivatedActorState(actorId);
}

export function placeResourceAt(x: i32, y: i32, vitalKind: i32, delta: i32, mode: i32): i32 {
  return placeResourceAtState(x, y, vitalKind, delta, mode);
}

export function removeResourceAt(x: i32, y: i32): i32 {
  return removeResourceAtState(x, y);
}

export function hasResourceAt(x: i32, y: i32): i32 {
  return hasResourceAtState(x, y);
}

export function getResourceVitalKindAt(x: i32, y: i32): i32 {
  return getResourceVitalKindAtState(x, y);
}

export function getResourceDeltaAt(x: i32, y: i32): i32 {
  return getResourceDeltaAtState(x, y);
}

export function getResourceModeAt(x: i32, y: i32): i32 {
  return getResourceModeAtState(x, y);
}

export function getResourceCount(): i32 {
  return getResourceCountState();
}

// ── Affinity codebook exports ──

export function getAffinityKindCount(): i32 {
  return getAffinityKindCountState();
}

export function getAffinityExpressionCount(): i32 {
  return getAffinityExpressionCountState();
}

export function getAffinityTargetTypeCount(): i32 {
  return getAffinityTargetTypeCountState();
}

export function getOppositeAffinityKind(kind: i32): i32 {
  return getOppositeAffinityKindState(kind);
}

export function resolveAffinityRelationshipCode(sourceKind: i32, targetKind: i32): i32 {
  return resolveAffinityRelationshipCodeState(sourceKind, targetKind);
}

export function getAffinityTargetVital(kind: i32): i32 {
  return getAffinityTargetVitalState(kind);
}

export function getDefaultAffinityTargetType(expression: i32): i32 {
  return getDefaultAffinityTargetTypeState(expression);
}

export function affinityExpressionAllowsEnvironmentMutation(expression: i32): i32 {
  return affinityExpressionAllowsEnvironmentMutationState(expression) ? 1 : 0;
}

export function affinityExpressionAllowsTrapArming(expression: i32): i32 {
  return affinityExpressionAllowsTrapArmingState(expression) ? 1 : 0;
}

export function affinityExpressionIsPersistentField(expression: i32): i32 {
  return affinityExpressionIsPersistentFieldState(expression) ? 1 : 0;
}

// ── Motivation codebook exports ──

export function getMotivationKindCount(): i32 {
  return getMotivationKindCountState();
}

export function getMotivationFamily(kind: i32): i32 {
  return getMotivationFamilyState(kind);
}

export function getMotivationExclusiveGroup(kind: i32): i32 {
  return getMotivationExclusiveGroupState(kind);
}

export function motivationKindsConflict(leftKind: i32, rightKind: i32): i32 {
  return motivationKindsConflictState(leftKind, rightKind) ? 1 : 0;
}

export function getMotivationPatternCount(kind: i32): i32 {
  return getMotivationPatternCountState(kind);
}

export function getMotivationPatternCodeAt(kind: i32, index: i32): i32 {
  return getMotivationPatternCodeAtState(kind, index);
}

export function getDefaultMotivationPattern(kind: i32): i32 {
  return getDefaultMotivationPatternState(kind);
}

// ── Motivation validation + cost exports ──

export function normalizeMotivationIntensity(raw: i32): i32 {
  return normalizeMotivationIntensityState(raw);
}

export function getMotivationTier(kind: i32): i32 {
  return getMotivationTierState(kind);
}

export function getMotivationDefaultUnitCost(kind: i32): i32 {
  return getMotivationDefaultUnitCostState(kind);
}

export function resetMotivationCostAccumulator(): i32 {
  return resetMotivationCostAccumulatorState();
}

export function addMotivationCostEntry(kind: i32, intensity: i32): i32 {
  return addMotivationCostEntryState(kind, intensity);
}

export function getMotivationCostTotal(): i32 {
  return getMotivationCostTotalState();
}

export function getMotivationCostLineCount(): i32 {
  return getMotivationCostLineCountState();
}

export function getMotivationCostLineKind(index: i32): i32 {
  return getMotivationCostLineKindState(index);
}

export function getMotivationCostLineFamily(index: i32): i32 {
  return getMotivationCostLineFamilyState(index);
}

export function getMotivationCostLineQuantity(index: i32): i32 {
  return getMotivationCostLineQuantityState(index);
}

export function getMotivationCostLineUnitCost(index: i32): i32 {
  return getMotivationCostLineUnitCostState(index);
}

export function getMotivationCostLineSpend(index: i32): i32 {
  return getMotivationCostLineSpendState(index);
}

// ── Motivation behavior flags + evaluation exports ──

export function getMotivationFlagCount(): i32 {
  return getMotivationFlagCountState();
}

export function getMotivationProfileCost(kind: i32): i32 {
  return getMotivationProfileCostState(kind);
}

export function getMotivationDefaultDesignCost(kind: i32): i32 {
  return getMotivationDefaultDesignCostState(kind);
}

export function getMotivationDefaultFlagMask(kind: i32): i32 {
  return getMotivationDefaultFlagMaskState(kind);
}

export function resetMotivationEvaluation(): i32 {
  return resetMotivationEvaluationState();
}

export function addMotivationEvaluationEntry(kind: i32, intensity: i32, pattern: i32, flagMask: i32): i32 {
  return addMotivationEvaluationEntryState(kind, intensity, pattern, flagMask);
}

export function evaluateMotivations(): i32 {
  return evaluateMotivationsState();
}

export function getLastMotivationFlags(): i32 {
  return getLastMotivationFlagsState();
}

export function getLastMotivationMobilityTier(): i32 {
  return getLastMotivationMobilityTierState();
}

export function getLastMotivationCombatTier(): i32 {
  return getLastMotivationCombatTierState();
}

export function getLastMotivationCognitionTier(): i32 {
  return getLastMotivationCognitionTierState();
}

export function getLastMotivationReasoningClass(): i32 {
  return getLastMotivationReasoningClassState();
}

// ── Affinity spatial formula exports ──

export function computeAffinityRadius(expression: i32, stacks: i32): i32 {
  return computeAffinityRadiusState(expression, stacks);
}

export function computeAffinityIntensity(distance: i32, stacks: i32, expression: i32): f64 {
  return computeAffinityIntensityState(distance, stacks, expression);
}

export function computeAffinityPotency(stacks: i32, expression: i32): f64 {
  return computeAffinityPotencyState(stacks, expression);
}

export function computeAffinityManaCost(stacks: i32, expression: i32): i32 {
  return computeAffinityManaCostState(stacks, expression);
}

export function resolveAffinityStackCancellation(sourceStacks: i32, targetStacks: i32): i32 {
  return resolveAffinityStackCancellationState(sourceStacks, targetStacks);
}

export function getLastAffinityCanceledStacks(): i32 {
  return getLastAffinityCanceledStacksState();
}

export function getLastAffinityNetSourceStacks(): i32 {
  return getLastAffinityNetSourceStacksState();
}

export function getLastAffinityNetTargetStacks(): i32 {
  return getLastAffinityNetTargetStacksState();
}

export function resolveAffinityMergedStacks(sourceStacks: i32, targetStacks: i32): i32 {
  return resolveAffinityMergedStacksState(sourceStacks, targetStacks);
}

// ── Affinity interaction matrix exports ──

export function getAffinityInteractionCellCount(): i32 {
  return getAffinityInteractionCellCountState();
}

export function getAffinityVisualStateCount(): i32 {
  return getAffinityVisualStateCountState();
}

export function getAffinityEffectCount(): i32 {
  return getAffinityEffectCountState();
}

export function getAffinityMatrixSourceEffect(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  return getAffinityMatrixSourceEffectState(srcExpr, tgtExpr, relationship);
}

export function getAffinityMatrixTargetEffect(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  return getAffinityMatrixTargetEffectState(srcExpr, tgtExpr, relationship);
}

export function getAffinityMatrixVisualState(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  return getAffinityMatrixVisualStateState(srcExpr, tgtExpr, relationship);
}

export function getAffinityMatrixUsesStackCancellation(srcExpr: i32, tgtExpr: i32, relationship: i32): i32 {
  return getAffinityMatrixUsesStackCancellationState(srcExpr, tgtExpr, relationship);
}

// ── Affinity field buffers ──

export function clearAffinityField(): i32 {
  return clearAffinityFieldState();
}

export function computeStaticTrapAffinityField(): i32 {
  return computeStaticTrapAffinityFieldState();
}

export function getAffinityFieldIntensityAt(x: i32, y: i32, kind: i32): f64 {
  return getAffinityFieldIntensityAtState(x, y, kind);
}

export function getAffinityFieldStacksAt(x: i32, y: i32, kind: i32): i32 {
  return getAffinityFieldStacksAtState(x, y, kind);
}

export function getAffinityFieldExpressionAt(x: i32, y: i32, kind: i32): i32 {
  return getAffinityFieldExpressionAtState(x, y, kind);
}

export function getAffinityFieldContributionCountAt(x: i32, y: i32, kind: i32): i32 {
  return getAffinityFieldContributionCountAtState(x, y, kind);
}

// ── Actor affinity state + field exports ──

export function setMotivatedActorAffinity(index: i32, kind: i32, expression: i32, stacks: i32): i32 {
  return setMotivatedActorAffinityState(index, kind, expression, stacks);
}

export function getMotivatedActorAffinityKindByIndex(index: i32): i32 {
  return getMotivatedActorAffinityKindByIndexState(index);
}

export function getMotivatedActorAffinityExpressionByIndex(index: i32): i32 {
  return getMotivatedActorAffinityExpressionByIndexState(index);
}

export function getMotivatedActorAffinityStacksByIndex(index: i32): i32 {
  return getMotivatedActorAffinityStacksByIndexState(index);
}

export function computeActorAffinityField(): i32 {
  return computeActorAffinityFieldState();
}

export function computeAffinityField(): i32 {
  return computeAffinityFieldState();
}

// ── Affinity interaction resolution exports ──

export function resolveAffinityInteraction(
  srcKind: i32, srcExpr: i32, srcStacks: i32,
  tgtKind: i32, tgtExpr: i32, tgtStacks: i32,
): i32 {
  return resolveAffinityInteractionState(srcKind, srcExpr, srcStacks, tgtKind, tgtExpr, tgtStacks);
}

export function resolveMotivatedActorAffinityInteraction(
  srcActorIndex: i32, tgtActorIndex: i32,
): i32 {
  return resolveMotivatedActorAffinityInteractionState(srcActorIndex, tgtActorIndex);
}

export function getLastInteractionSourceEffect(): i32 {
  return getLastInteractionSourceEffectState();
}

export function getLastInteractionTargetEffect(): i32 {
  return getLastInteractionTargetEffectState();
}

export function getLastInteractionVisualState(): i32 {
  return getLastInteractionVisualStateState();
}

export function getLastInteractionRelationship(): i32 {
  return getLastInteractionRelationshipState();
}

export function getLastInteractionNetSourceStacks(): i32 {
  return getLastInteractionNetSourceStacksState();
}

export function getLastInteractionNetTargetStacks(): i32 {
  return getLastInteractionNetTargetStacksState();
}

export function getLastInteractionCanceledStacks(): i32 {
  return getLastInteractionCanceledStacksState();
}
