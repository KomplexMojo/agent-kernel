/**
 * Incentive alignment model (design §3).
 *
 * The incentive multiplier rewards builds where delver and warden
 * spending is near the intended ratio. It is a derived balance signal,
 * not a hard enforcement gate.
 */

import {
  REFERENCE_BUDGET_TOKENS,
  REFERENCE_TARGETS,
  TARGET_DELVER_WARDEN_RATIO,
} from "../director/budget-allocation.js";

/**
 * Compute the incentive multiplier (design §3.3).
 *
 *   IncentiveMultiplier = max(0, 1 - 1.25 × |D/W - 0.8|)
 *
 * @param {number} delverSpend - Actual delver spend (D).
 * @param {number} wardenSpend - Actual warden spend (W).
 * @returns {number} Incentive multiplier in [0, 1].
 */
export function computeIncentiveMultiplier(delverSpend, wardenSpend) {
  if (!Number.isFinite(delverSpend) || !Number.isFinite(wardenSpend)) return 0;
  if (wardenSpend <= 0) return 0;
  const ratio = delverSpend / wardenSpend;
  const mismatch = Math.abs(ratio - TARGET_DELVER_WARDEN_RATIO);
  return Math.max(0, 1 - 1.25 * mismatch);
}

/**
 * Build a scenario-level spend report (design §14).
 *
 * @param {Object} options
 * @param {number} options.roomsSpend - Actual rooms/layout/trap spend.
 * @param {number} options.delverSpend - Actual delver spend.
 * @param {number} options.wardenSpend - Actual warden spend.
 * @param {number} [options.budgetTokens] - Total scenario budget (defaults to REFERENCE_BUDGET_TOKENS).
 * @returns {Object} Scenario spend report.
 */
export function buildScenarioSpendReport({
  roomsSpend = 0,
  delverSpend = 0,
  wardenSpend = 0,
  budgetTokens = REFERENCE_BUDGET_TOKENS,
} = {}) {
  const totalSpend = roomsSpend + delverSpend + wardenSpend;
  const budget = Number.isInteger(budgetTokens) && budgetTokens > 0
    ? budgetTokens
    : REFERENCE_BUDGET_TOKENS;

  const actualRatio = wardenSpend > 0 ? delverSpend / wardenSpend : 0;
  const incentiveMultiplier = computeIncentiveMultiplier(delverSpend, wardenSpend);

  return {
    budget,
    totalSpend,
    remainingBudget: Math.max(0, budget - totalSpend),
    overBudget: totalSpend > budget,

    // Per-category actuals and targets (design §14.1–14.3)
    categories: {
      rooms: {
        actual: roomsSpend,
        target: REFERENCE_TARGETS.rooms,
        usagePercent: REFERENCE_TARGETS.rooms > 0
          ? Math.round((roomsSpend / REFERENCE_TARGETS.rooms) * 100)
          : 0,
      },
      delvers: {
        actual: delverSpend,
        target: REFERENCE_TARGETS.delvers,
        usagePercent: REFERENCE_TARGETS.delvers > 0
          ? Math.round((delverSpend / REFERENCE_TARGETS.delvers) * 100)
          : 0,
      },
      wardens: {
        actual: wardenSpend,
        target: REFERENCE_TARGETS.wardens,
        usagePercent: REFERENCE_TARGETS.wardens > 0
          ? Math.round((wardenSpend / REFERENCE_TARGETS.wardens) * 100)
          : 0,
      },
    },

    totalBudgetUsagePercent: budget > 0
      ? Math.round((totalSpend / budget) * 100)
      : 0,

    // Incentive reporting (design §14.4)
    incentive: {
      actualRatio: Math.round(actualRatio * 1000) / 1000,
      targetRatio: TARGET_DELVER_WARDEN_RATIO,
      mismatch: Math.round(Math.abs(actualRatio - TARGET_DELVER_WARDEN_RATIO) * 1000) / 1000,
      multiplier: Math.round(incentiveMultiplier * 1000) / 1000,
    },
  };
}

export { REFERENCE_BUDGET_TOKENS, REFERENCE_TARGETS, TARGET_DELVER_WARDEN_RATIO };
