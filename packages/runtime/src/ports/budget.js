import { resolveBudgetCategoryId } from "../contracts/budget-categories.js";
import { ActionKind } from "../../../core-ts/src/index.ts";

/**
 * Injects the Allocator's per-action costs into core's budget ledger.
 *
 * Core owns the action codes and enforces caps; the Allocator owns the
 * numbers (charter: "Economy — Allocator Authority"). Before P1.5b core
 * hardcoded `RequestSolver ? 2 : 1`, which put pricing in core.
 *
 * `default` is applied to every action kind, then named kinds override it.
 *
 * @param {object} core
 * @param {{default?: number, requestSolver?: number}} costs
 * @returns {Array<{kind: number, cost: number}>} applied overrides
 */
export function applyActionBudgetCosts(core, costs) {
  if (!core?.setActionBudgetCost || !costs || typeof costs !== "object") {
    return [];
  }
  const applied = [];
  const fallback = Number(costs.default);
  if (Number.isFinite(fallback) && fallback >= 0) {
    for (const kind of Object.values(ActionKind)) {
      if (typeof kind === "number") {
        core.setActionBudgetCost(kind, fallback);
      }
    }
  }
  const solver = Number(costs.requestSolver);
  if (Number.isFinite(solver) && solver >= 0) {
    core.setActionBudgetCost(ActionKind.RequestSolver, solver);
    applied.push({ kind: ActionKind.RequestSolver, cost: solver });
  }
  return applied;
}

export function applyBudgetCaps(core, simConfig) {
  const caps = simConfig?.constraints?.categoryCaps?.caps;
  if (!caps || !core?.setBudget) {
    return [];
  }

  const applied = [];
  for (const [category, cap] of Object.entries(caps)) {
    const categoryId = resolveBudgetCategoryId(category);
    if (categoryId === null) {
      continue;
    }
    const numericCap = Number(cap);
    if (!Number.isFinite(numericCap)) {
      continue;
    }
    core.setBudget(categoryId, numericCap);
    applied.push({ category, categoryId, cap: numericCap });
  }

  return applied;
}

/**
 * Read core's budget ledger — issued caps beside the spend core has charged.
 *
 * P5.5. Core has exposed `getBudgetUsage` since it had a budget at all, and
 * until now NOTHING in runtime read it: caps went in through `applyBudgetCaps`
 * and the counters were never looked at again. That is the whole reason the
 * Allocator's chartered reconciliation could not exist — the actual half of
 * "actual versus issued" was write-only.
 *
 * This is a READ, not a decision: it reports what core charged and takes no view
 * on whether that is acceptable. The verdict is the Allocator's
 * (`personas/allocator/reconciliation.js`), which is why this returns a plain
 * ledger rather than a disposition.
 *
 * `appliedCaps` is `applyBudgetCaps`'s own return value, so the ledger covers
 * exactly the categories a cap was actually issued for. Deriving the list from
 * BUDGET_CATEGORY_IDS instead would report `movement`, `default` and `action` as
 * three categories when they are three names for core's category 0.
 *
 * @param {object} core
 * @param {Array<{category: string, categoryId: number, cap: number}>} appliedCaps
 * @returns {{categories: Array<{category: string, categoryId: number, issued: number,
 *   spent: number}>} | null} null when core exposes no usage counter — the caller
 *   must then not claim a reconciliation happened.
 */
export function readBudgetLedger(core, appliedCaps = []) {
  if (typeof core?.getBudgetUsage !== "function" || !Array.isArray(appliedCaps)) {
    return null;
  }
  const seen = new Set();
  const categories = [];
  for (const entry of appliedCaps) {
    const categoryId = entry?.categoryId;
    if (typeof categoryId !== "number" || seen.has(categoryId)) {
      continue;
    }
    seen.add(categoryId);
    const spent = Number(core.getBudgetUsage(categoryId));
    categories.push({
      category: entry.category,
      categoryId,
      issued: Number(entry.cap),
      spent: Number.isFinite(spent) ? spent : 0,
    });
  }
  return categories.length > 0 ? { categories } : null;
}
