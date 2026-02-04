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
  setMotivatedActorVital as setMotivatedActorVitalState,
  setMotivatedActorMovementCost as setMotivatedActorMovementCostState,
  setMotivatedActorActionCostMana as setMotivatedActorActionCostManaState,
  setMotivatedActorActionCostStamina as setMotivatedActorActionCostStaminaState,
} from "./state/world";
import { applyMove, decodeMove, reachedExitAfterMove, setMoveAction as setMoveActionState } from "./rules/move";
import { ActionKind, ValidationError, validateAction, validateSeed } from "./validate/inputs";

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

export function applyAction(kind: i32, value: i32): void {
  if (kind == ActionKind.Move) {
    const move = decodeMove(value);
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
    return;
  }

  const actionError = validateAction(kind, value);
  if (actionError != ValidationError.None) {
    pushEffect(EffectKind.ActionRejected, actionError);
    return;
  }

  if (kind == ActionKind.FulfillRequest || kind == ActionKind.DeferRequest) {
    const pending = getPendingRequest();
    if (pending == 0) {
      pushEffect(EffectKind.ActionRejected, ValidationError.MissingPendingRequest);
      return;
    }
    if (pending != value) {
      pushEffect(EffectKind.ActionRejected, ValidationError.InvalidActionValue);
      return;
    }
  }

  const budgetCategory = kind == ActionKind.RequestExternalFact || kind == ActionKind.RequestSolver
    ? EFFECT_BUDGET_CATEGORY
    : DEFAULT_BUDGET_CATEGORY;
  const budgetCost = kind == ActionKind.RequestSolver ? 2 : 1;
  const nextSpent = chargeBudget(budgetCategory, budgetCost);
  emitBudgetEffects(budgetCategory, nextSpent);

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
