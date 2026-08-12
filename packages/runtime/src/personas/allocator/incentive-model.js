/**
 * Incentive alignment model (design §3).
 *
 * The incentive multiplier rewards builds where delver and warden
 * spending is near the intended ratio. It is a derived balance signal,
 * not a hard enforcement gate.
 */

import {
  computeBudgetPools,
  REFERENCE_BUDGET_TOKENS,
  REFERENCE_TARGETS,
  TARGET_DELVER_WARDEN_RATIO,
} from "../director/budget-allocation.js";

const REPORT_CATEGORIES = Object.freeze([
  "rooms",
  "floor_tiles",
  "hazards",
  "hazards",
  "resources",
  "delvers",
  "wardens",
  "shared_system",
]);

const CATEGORY_POOL_IDS = Object.freeze({
  rooms: "rooms",
  floor_tiles: "rooms",
  hazards: "rooms",
  hazards: "hazards",
  resources: "resources",
  delvers: "delver",
  wardens: "wardens",
  shared_system: "rooms",
});

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

function normalizeSpend(value) {
  return Number.isFinite(value) ? value : 0;
}

function buildPoolTargets({ budgetTokens, allocation } = {}) {
  const pools = Array.isArray(allocation?.pools)
    ? allocation.pools
    : computeBudgetPools({ budgetTokens }).pools;
  return new Map((pools || []).map((pool) => [pool.id, Number.isInteger(pool.tokens) ? pool.tokens : 0]));
}

function buildCategoryTargets({ budgetTokens, allocation } = {}) {
  const poolTargets = buildPoolTargets({ budgetTokens, allocation });
  const fallbackScale = (Number.isInteger(budgetTokens) && budgetTokens > 0 ? budgetTokens : REFERENCE_BUDGET_TOKENS)
    / REFERENCE_BUDGET_TOKENS;
  const fallback = {
    rooms: Math.round(REFERENCE_TARGETS.rooms * fallbackScale),
    floor_tiles: Math.round(REFERENCE_TARGETS.rooms * fallbackScale),
    hazards: Math.round(REFERENCE_TARGETS.rooms * fallbackScale),
    hazards: Math.round((REFERENCE_TARGETS.hazards || 0) * fallbackScale),
    resources: Math.round(REFERENCE_TARGETS.resources * fallbackScale),
    delvers: Math.round(REFERENCE_TARGETS.delvers * fallbackScale),
    wardens: Math.round(REFERENCE_TARGETS.wardens * fallbackScale),
    shared_system: 0,
  };
  return Object.fromEntries(REPORT_CATEGORIES.map((category) => {
    const poolId = CATEGORY_POOL_IDS[category];
    const poolTarget = poolId ? poolTargets.get(poolId) : undefined;
    return [category, Number.isInteger(poolTarget) ? poolTarget : fallback[category] || 0];
  }));
}

function sumLineItemsByCategory(lineItems = []) {
  const categorySpend = Object.fromEntries(REPORT_CATEGORIES.map((category) => [category, 0]));
  lineItems.forEach((item) => {
    const category = typeof item?.category === "string" ? item.category : null;
    if (!category || !Object.prototype.hasOwnProperty.call(categorySpend, category)) return;
    categorySpend[category] += normalizeSpend(item.totalCost);
  });
  return categorySpend;
}

function buildLegacyCategorySpend({ roomsSpend, delverSpend, wardenSpend, resourcesSpend } = {}) {
  return {
    rooms: normalizeSpend(roomsSpend),
    floor_tiles: 0,
    hazards: 0,
    hazards: 0,
    resources: normalizeSpend(resourcesSpend),
    delvers: normalizeSpend(delverSpend),
    wardens: normalizeSpend(wardenSpend),
    shared_system: 0,
  };
}

function buildCategorySpend(options = {}) {
  if (Array.isArray(options.lineItems)) {
    return sumLineItemsByCategory(options.lineItems);
  }
  if (options.categorySpend && typeof options.categorySpend === "object") {
    return Object.fromEntries(REPORT_CATEGORIES.map((category) => [
      category,
      normalizeSpend(options.categorySpend[category]),
    ]));
  }
  return buildLegacyCategorySpend(options);
}

function buildCategory(actual, target) {
  return {
    actual,
    target,
    usagePercent: target > 0 ? Math.round((actual / target) * 100) : 0,
  };
}

/**
 * Build a scenario-level spend report (design §14).
 *
 * @param {Object} options
 * @param {number} options.roomsSpend - Actual rooms/layout/hazard spend.
 * @param {number} options.delverSpend - Actual delver spend.
 * @param {number} options.wardenSpend - Actual warden spend.
 * @param {number} [options.budgetTokens] - Total scenario budget (defaults to REFERENCE_BUDGET_TOKENS).
 * @returns {Object} Scenario spend report.
 */
export function buildScenarioSpendReport({
  roomsSpend = 0,
  delverSpend = 0,
  wardenSpend = 0,
  resourcesSpend = 0,
  lineItems,
  categorySpend,
  allocation,
  budgetTokens = REFERENCE_BUDGET_TOKENS,
} = {}) {
  const budget = Number.isInteger(budgetTokens) && budgetTokens > 0
    ? budgetTokens
    : REFERENCE_BUDGET_TOKENS;
  const spend = buildCategorySpend({
    roomsSpend,
    delverSpend,
    wardenSpend,
    resourcesSpend,
    lineItems,
    categorySpend,
  });
  spend.rooms += spend.floor_tiles + spend.hazards + spend.shared_system;
  const totalSpend = Array.isArray(lineItems)
    ? lineItems.reduce((sum, item) => sum + normalizeSpend(item.totalCost), 0)
    : spend.rooms + spend.hazards + spend.resources + spend.delvers + spend.wardens;
  const targets = buildCategoryTargets({ budgetTokens: budget, allocation });

  const actualRatio = spend.wardens > 0 ? spend.delvers / spend.wardens : 0;
  const incentiveMultiplier = computeIncentiveMultiplier(spend.delvers, spend.wardens);

  return {
    budget,
    totalSpend,
    remainingBudget: Math.max(0, budget - totalSpend),
    overBudget: totalSpend > budget,

    categories: Object.fromEntries(REPORT_CATEGORIES.map((category) => [
      category,
      buildCategory(spend[category], targets[category]),
    ])),

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
