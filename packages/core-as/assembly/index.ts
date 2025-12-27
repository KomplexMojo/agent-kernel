// Entry points exported to WASM.
// Keep exports small and stable.
import { EffectKind, clearEffects, getEffectCount, getEffectKind, getEffectValue, pushEffect } from "./ports/effects";
import { chargeBudget, getBudgetCap, resetBudgets, setBudgetCap, getBudgetSpent } from "./state/budget";
import { getCounterValue, incrementCounter, resetCounter } from "./state/counter";
import { ValidationError, validateAction, validateSeed } from "./validate/inputs";

const DEFAULT_BUDGET_CATEGORY: i32 = 0;

export function version(): i32 {
  return 1;
}

export function init(seed: i32): void {
  clearEffects();
  resetBudgets();
  const seedError = validateSeed(seed);
  if (seedError != ValidationError.None) {
    pushEffect(EffectKind.InitInvalid, seedError);
    return;
  }
  resetCounter(seed);
}

export function step(): void {
  applyAction(1, 1);
}

export function applyAction(kind: i32, value: i32): void {
  const actionError = validateAction(kind, value);
  if (actionError != ValidationError.None) {
    pushEffect(EffectKind.ActionRejected, actionError);
    return;
  }
  const nextSpent = chargeBudget(DEFAULT_BUDGET_CATEGORY, 1);
  const cap = getBudgetCap(DEFAULT_BUDGET_CATEGORY);
  if (cap >= 0 && nextSpent == cap) {
    pushEffect(EffectKind.LimitReached, nextSpent);
  } else if (cap >= 0 && nextSpent > cap) {
    pushEffect(EffectKind.LimitViolated, nextSpent);
  }
  const nextValue = incrementCounter();
  pushEffect(EffectKind.Log, nextValue);
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
