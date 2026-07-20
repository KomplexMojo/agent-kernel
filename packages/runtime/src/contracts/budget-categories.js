import { BudgetCategory } from "../../../core-ts/src/index.ts";

/**
 * Human-facing cap names → **core's** budget category ids.
 *
 * Core owns the numbering (maintainer decision 2026-07-20); this module only
 * translates. It previously carried its own invented ids, which silently
 * broke enforcement: `effects` resolved to 3 — an index core never charges —
 * so an effects cap was inert and emitted no limit events, while `cognition`
 * (1) accidentally capped effect actions. Only categories core actually
 * models may appear here; unknown names resolve to null and are skipped by
 * applyBudgetCaps rather than misapplied.
 *
 * `movement` is retained as a legacy alias for Default (existing sim-configs
 * use it), but core charges every non-request action there, not just moves.
 */
export const BUDGET_CATEGORY_IDS = Object.freeze({
  default: BudgetCategory.Default,
  action: BudgetCategory.Default,
  movement: BudgetCategory.Default,
  effects: BudgetCategory.Effects,
  effect: BudgetCategory.Effects,
});

export function resolveBudgetCategoryId(name) {
  if (typeof name === "number" && Number.isFinite(name)) {
    return name;
  }
  if (typeof name !== "string") {
    return null;
  }
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return BUDGET_CATEGORY_IDS[normalized] ?? null;
}
