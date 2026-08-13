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
 *
 * 🔴 **AND IT NEVER CHARGES MOVES AT ALL — so a `movement` cap is inert against the
 * one thing its name promises.** `core.applyAction` returns for `ActionKind.Move`
 * BEFORE `chargeBudgetForAction` (core-ts/src/index.ts), so a run that moves three
 * hundred times reconciles as spend 0 on this category. Found by P5.5, which built the
 * Allocator's reconciliation and therefore read `getBudgetUsage` for the first time —
 * the counter had had no runtime reader at all, which is exactly why an inert cap was
 * indistinguishable from a cap nobody hit. This is the SAME defect class the paragraph
 * above records for `effects`/`cognition`, one layer down: there the id was wrong, here
 * the charge is missing.
 *
 * Deliberately NOT fixed in P5.5: charging moves changes budget behaviour on every run
 * and moves goldens, and whether moves are meant to be free is a game-design call rather
 * than an architecture one. Recorded here because the sentence above is what a reader
 * consults, and on its own it implies the opposite.
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
