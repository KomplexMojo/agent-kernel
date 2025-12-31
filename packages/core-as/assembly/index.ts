// Entry points exported to WASM.
// Keep exports small and stable.
import { EffectKind, clearEffects, getEffectCount, getEffectKind, getEffectValue, pushEffect } from "./ports/effects";
import { chargeBudget, getBudgetCap, resetBudgets, setBudgetCap, getBudgetSpent } from "./state/budget";
import { getCounterValue, incrementCounter, resetCounter } from "./state/counter";
import { clearPendingRequest, getPendingRequest, nextRequestSequence, resetEffectState, setPendingRequest } from "./state/effects";
import { ActionKind, ValidationError, validateAction, validateSeed } from "./validate/inputs";

const DEFAULT_BUDGET_CATEGORY: i32 = 0;
const EFFECT_BUDGET_CATEGORY: i32 = 1;
const REQUEST_DETAIL_MASK: i32 = 0xff;

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
