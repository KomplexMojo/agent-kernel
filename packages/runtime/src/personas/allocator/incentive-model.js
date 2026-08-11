/**
 * Incentive alignment model (design §3).
 *
 * The incentive multiplier rewards builds where delver and warden
 * spending is near the intended ratio. It is a derived balance signal,
 * not a hard enforcement gate.
 */

import {
  computeBudgetPools,
  POOL_ID_BY_SPEND_CATEGORY,
  REFERENCE_BUDGET_TOKENS,
  REFERENCE_TARGETS,
  TARGET_DELVER_WARDEN_RATIO,
} from "./budget-allocation.js";

// ⚠️ `hazards` was listed TWICE in each of the vocabularies below and in the category → pool
// map, which at the time existed twice — five duplicates telling one story.
// Hazards used to bill to the ROOMS pool; when they got their own pool (15% of the dungeon
// split, `DEFAULT_DUNGEON_SUB_POOLS`) the new line was added BELOW the old one instead of
// replacing it. It worked only because a JS object literal takes the LAST duplicate key,
// so `hazards → "hazards"` has been the live mapping all along and `hazards → "rooms"` was
// dead code that still read like policy.
//
// Removing the dead entries is behavior-preserving by construction — the surviving value
// is the one that was already winning — and the goldens are the gate.
const REPORT_CATEGORIES = Object.freeze([
  "rooms",
  "floor_tiles",
  "hazards",
  "resources",
  "delvers",
  "wardens",
  "shared_system",
]);

// `POOL_ID_BY_SPEND_CATEGORY` was declared here and, verbatim, in validate-spend.js — which is
// exactly why the `hazards` duplicate-key defect above existed in both: the map was copied, so
// the bug was copied with it. It now has one origin, in budget-allocation.js beside the pools
// it names, and `tests/architecture/single-origin.test.js` forbids a second declaration.

/**
 * The categories the `rooms` ROW rolls up — DERIVED from the map, not restated.
 *
 * `rooms` in the report is not the `rooms` category, it is the rooms POOL: the row's target
 * is the pool's allocation, so its actual has to be every category drawing on that pool.
 *
 * ⚠️ IT WAS HAND-WRITTEN AS `floor_tiles + hazards + shared_system` AND HAD GONE STALE.
 * Hazards have their own pool (15% of the dungeon split) and their own row with their own
 * target, so folding them into `rooms` compared a hazards-INCLUSIVE actual against a
 * hazards-EXCLUSIVE target, and reported the same tokens in two rows. It was the identical
 * pre-pool-split policy that `POOL_ID_BY_SPEND_CATEGORY` carried as a dead `hazards: "rooms"`
 * entry — a third spelling of one stale fact, in arithmetic, where neither the duplicate-key
 * guard nor the single-origin guard could see it.
 *
 * Deriving it from the map is the fix for the class, not just the instance: repoint a category
 * and the rollup follows, and no future pool split can leave this line behind.
 */
const ROOMS_POOL_CATEGORIES = Object.freeze(
  REPORT_CATEGORIES.filter(
    (category) => category !== "rooms"
      && POOL_ID_BY_SPEND_CATEGORY[category] === POOL_ID_BY_SPEND_CATEGORY.rooms,
  ),
);

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
    // The dead `REFERENCE_TARGETS.rooms` twin is gone; `REFERENCE_TARGETS.hazards` is what
    // this key has actually resolved to. `floor_tiles` still falls back to the rooms
    // target on purpose — floor tiles have no pool of their own.
    hazards: Math.round((REFERENCE_TARGETS.hazards || 0) * fallbackScale),
    resources: Math.round(REFERENCE_TARGETS.resources * fallbackScale),
    delvers: Math.round(REFERENCE_TARGETS.delvers * fallbackScale),
    wardens: Math.round(REFERENCE_TARGETS.wardens * fallbackScale),
    shared_system: 0,
  };
  return Object.fromEntries(REPORT_CATEGORIES.map((category) => {
    const poolId = POOL_ID_BY_SPEND_CATEGORY[category];
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
  // Every category, each counted ONCE, taken BEFORE the rooms rollup below so this total
  // cannot be changed by redefining what the rollup absorbs. The previous form spelled the
  // sum out as `spend.rooms + spend.hazards + …` AFTER the rollup, which double-counted
  // hazards for as long as the rollup was absorbing them.
  //
  // ⚠️ HARDENING, NOT A SECOND FIX, and the perturbation says so: with the rollup corrected,
  // the old spelled-out form gives the same answer, so no black-box test can tell the two
  // apart. The double-count was a CONSEQUENCE of the stale rollup rather than an independent
  // defect. What this form buys is that the next change to the rollup cannot silently move
  // the total — which is exactly how the last one did.
  const categoryTotal = REPORT_CATEGORIES.reduce((sum, c) => sum + normalizeSpend(spend[c]), 0);

  spend.rooms += ROOMS_POOL_CATEGORIES.reduce((sum, c) => sum + normalizeSpend(spend[c]), 0);

  const totalSpend = Array.isArray(lineItems)
    ? lineItems.reduce((sum, item) => sum + normalizeSpend(item.totalCost), 0)
    : categoryTotal;
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
