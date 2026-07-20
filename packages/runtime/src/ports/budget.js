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
