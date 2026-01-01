// Entry points exported to WASM.
// Keep exports small and stable.
import { EffectKind, clearEffects, getEffectCount, getEffectKind, getEffectValue, pushEffect } from "./ports/effects";
import { chargeBudget, getBudgetCap, resetBudgets, setBudgetCap, getBudgetSpent } from "./state/budget";
import { getCounterValue, incrementCounter, resetCounter } from "./state/counter";
import { clearPendingRequest, getPendingRequest, nextRequestSequence, resetEffectState, setPendingRequest } from "./state/effects";
import {
  loadMvpWorld,
  loadMvpBarrierWorld,
  renderBaseCell,
  renderCell,
  resetWorld,
  getMapWidth as worldMapWidth,
  getMapHeight as worldMapHeight,
  getActorX as getActorXState,
  getActorY as getActorYState,
  getActorKind as getActorKindState,
  getActorVitalCurrent as getActorVitalCurrentState,
  getActorVitalMax as getActorVitalMaxState,
  getActorVitalRegen as getActorVitalRegenState,
  setActorVital as setActorVitalState,
  validateActorVitals as validateActorVitalsState,
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
  validateActorPlacement as validateActorPlacementState,
  getCurrentTick as getCurrentTickValue,
  getActorHp as getActorHpState,
  getActorMaxHp as getActorMaxHpState,
  getActorId as getActorIdState,
} from "./state/world";
import { applyMove, decodeMove, reachedExitAfterMove } from "./rules/move";
import { ActionKind, ValidationError, validateAction, validateSeed } from "./validate/inputs";

const DEFAULT_BUDGET_CATEGORY: i32 = 0;
const EFFECT_BUDGET_CATEGORY: i32 = 1;
const REQUEST_DETAIL_MASK: i32 = 0xff;
const DURABILITY_DAMAGE: i32 = 1;
const ACTOR_VALUE_SHIFT: i32 = 24;
const Y_VALUE_SHIFT: i32 = 16;
const X_VALUE_SHIFT: i32 = 8;
const VALUE_MASK: i32 = 0xff;

function encodeRequestPayload(seq: i32, detail: i32): i32 {
  return (seq << 8) | (detail & REQUEST_DETAIL_MASK);
}

function encodeDurabilityChange(actorId: i32, delta: i32): i32 {
  return ((actorId & 0xffff) << 16) | (delta & 0xffff);
}

function encodeActorPosition(actorId: i32, x: i32, y: i32): i32 {
  return ((actorId & VALUE_MASK) << ACTOR_VALUE_SHIFT)
    | ((y & VALUE_MASK) << Y_VALUE_SHIFT)
    | ((x & VALUE_MASK) << X_VALUE_SHIFT);
}

function encodeActorBlocked(actorId: i32, x: i32, y: i32, reason: i32): i32 {
  return ((actorId & VALUE_MASK) << ACTOR_VALUE_SHIFT)
    | ((y & VALUE_MASK) << Y_VALUE_SHIFT)
    | ((x & VALUE_MASK) << X_VALUE_SHIFT)
    | (reason & VALUE_MASK);
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
        pushEffect(EffectKind.ActorBlocked, encodeActorBlocked(move.actorId, move.toX, move.toY, moveError));
        if (moveError == ValidationError.BlockedByWall && isBarrierTileState(move.toX, move.toY)) {
          const delta = applyBarrierDurabilityDamageState(move.toX, move.toY, DURABILITY_DAMAGE);
          const tileActorId = getTileActorIdState(move.toX, move.toY);
          pushEffect(EffectKind.DurabilityChanged, encodeDurabilityChange(tileActorId, delta));
        }
        return;
      }
      pushEffect(EffectKind.ActionRejected, moveError);
      return;
    }
    pushEffect(EffectKind.ActorMoved, encodeActorPosition(move.actorId, move.toX, move.toY));
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

// Movement-specific helpers for rendering and inspection.
export function loadMvpScenario(): void {
  loadMvpWorld();
}

export function loadMvpBarrierScenario(): void {
  loadMvpBarrierWorld();
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

export function getActorVitalCurrent(kind: i32): i32 {
  return getActorVitalCurrentState(kind);
}

export function getActorVitalMax(kind: i32): i32 {
  return getActorVitalMaxState(kind);
}

export function getActorVitalRegen(kind: i32): i32 {
  return getActorVitalRegenState(kind);
}

export function setActorVital(kind: i32, current: i32, max: i32, regen: i32): void {
  setActorVitalState(kind, current, max, regen);
}

export function validateActorVitals(): i32 {
  return validateActorVitalsState();
}

export function renderCellChar(x: i32, y: i32): i32 {
  return renderCell(x, y);
}

export function renderBaseCellChar(x: i32, y: i32): i32 {
  return renderBaseCell(x, y);
}
