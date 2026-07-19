/**
 * Canonical motivation price policy.
 *
 * All motivation cost decisions resolve from this module.
 * Prices are keyed by motivation kind and grouped by family.
 * The Allocator owns this policy; other layers read it.
 *
 * Pricing rule (from spec):
 *   total motivation cost = mobility price + posture price + cognition price
 *
 * Legacy cognition ordering preserved:
 *   reflexive (1) < goal_oriented (5) < strategy_focused (10)
 */

/**
 * Motivation families and the kinds they contain.
 * The family grouping mirrors the canonical vocabulary, but the
 * source-of-truth for which kinds exist lives in motivation-loadouts.js.
 * This module only cares about pricing.
 */
export const MOTIVATION_FAMILIES = Object.freeze({
  mobility: Object.freeze(["random", "stationary", "exploring", "patrolling"]),
  posture: Object.freeze(["attacking", "defending", "stealthy", "friendly"]),
  cognition: Object.freeze(["reflexive", "goal_oriented", "strategy_focused"]),
  control: Object.freeze(["user_controlled"]),
});

import BASE_COSTS from "./base-costs.json" with { type: "json" };

/**
 * Motivation tier classification (design §6.6).
 * Tier prices live in base-costs.json (motivationFallback group).
 */
export const MOTIVATION_TIER = Object.freeze({
  // Simple motivations (25 tokens)
  random: "simple",
  stationary: "simple",
  exploring: "simple",
  patrolling: "simple",
  attacking: "simple",
  defending: "simple",
  friendly: "simple",
  reflexive: "simple",
  user_controlled: "control",

  // Advanced motivations (50 tokens)
  stealthy: "advanced",
  goal_oriented: "advanced",
  strategy_focused: "advanced",
});

/** Simple motivation flat cost (design §6.6) — number lives in base-costs.json. */
export const SIMPLE_MOTIVATION_COST = BASE_COSTS.motivationFallback.fallback_simple;

/** Advanced motivation flat cost (design §6.6) — number lives in base-costs.json. */
export const ADVANCED_MOTIVATION_COST = BASE_COSTS.motivationFallback.fallback_advanced;

/**
 * Default per-kind cost in tokens (design §6.6).
 * Simple motivations = 25, advanced motivations = 50.
 */
export const DEFAULT_MOTIVATION_COSTS = Object.freeze({
  // Mobility — simple
  random: SIMPLE_MOTIVATION_COST,
  stationary: SIMPLE_MOTIVATION_COST,
  exploring: SIMPLE_MOTIVATION_COST,
  patrolling: SIMPLE_MOTIVATION_COST,

  // Posture — simple except stealthy
  attacking: SIMPLE_MOTIVATION_COST,
  defending: SIMPLE_MOTIVATION_COST,
  stealthy: ADVANCED_MOTIVATION_COST,
  friendly: SIMPLE_MOTIVATION_COST,

  // Cognition — reflexive is simple; goal_oriented and strategy_focused are advanced
  reflexive: SIMPLE_MOTIVATION_COST,
  goal_oriented: ADVANCED_MOTIVATION_COST,
  strategy_focused: ADVANCED_MOTIVATION_COST,
  user_controlled: BASE_COSTS.motivationFallback.fallback_user_controlled,
});

/**
 * Price list item IDs used in PriceList artifacts.
 * Maps motivation kind → price list item id.
 */
export const MOTIVATION_PRICE_IDS = Object.freeze({
  random: "motivation_random",
  stationary: "motivation_stationary",
  exploring: "motivation_exploring",
  patrolling: "motivation_patrolling",
  attacking: "motivation_attacking",
  defending: "motivation_defending",
  stealthy: "motivation_stealthy",
  friendly: "motivation_friendly",
  reflexive: "motivation_reflexive",
  goal_oriented: "motivation_goal_oriented",
  strategy_focused: "motivation_strategy_focused",
  user_controlled: "motivation_user_controlled",
});

const MOTIVATION_PRICE_KIND = "motivation";

/**
 * Resolve the unit cost for a single motivation kind.
 *
 * Resolution order:
 *   1. PriceList artifact (via priceMap)
 *   2. DEFAULT_MOTIVATION_COSTS fallback
 *
 * @param {string} kind - The motivation kind (e.g. "reflexive").
 * @param {Map<string,number>} [priceMap] - Optional map from "kind:id" → costTokens.
 * @returns {number} The resolved unit cost (>= 0).
 */
export function resolveMotivationUnitCost(kind, priceMap) {
  const priceId = MOTIVATION_PRICE_IDS[kind];
  if (priceMap && priceId) {
    const key = `${MOTIVATION_PRICE_KIND}:${priceId}`;
    const fromList = priceMap.get(key);
    if (Number.isFinite(fromList) && fromList >= 0) {
      return fromList;
    }
  }
  const fallback = DEFAULT_MOTIVATION_COSTS[kind];
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

/**
 * Identify which family a motivation kind belongs to.
 *
 * @param {string} kind
 * @returns {string|null} Family name or null if unknown.
 */
export function resolveMotivationFamily(kind) {
  for (const [family, kinds] of Object.entries(MOTIVATION_FAMILIES)) {
    if (kinds.includes(kind)) return family;
  }
  return null;
}

/**
 * Calculate the total motivation cost for a list of normalized motivations.
 *
 * Each motivation contributes its unit cost × intensity.
 * Costs are additive across families.
 *
 * @param {Array<{kind:string, intensity?:number}>} motivations
 * @param {Map<string,number>} [priceMap]
 * @returns {{cost:number, lineItems:Array<{kind:string, motivationKind:string, id:string, unitCost:number, intensity:number, spendTokens:number}>}}
 */
export function calculateMotivationStackCost(motivations, priceMap) {
  const lineItems = [];
  let totalCost = 0;

  if (!Array.isArray(motivations)) {
    return { cost: 0, lineItems };
  }

  for (const entry of motivations) {
    if (!entry || typeof entry.kind !== "string") continue;
    const kind = entry.kind;
    const intensity = Number.isInteger(entry.intensity) && entry.intensity > 0
      ? entry.intensity
      : 1;
    const unitCost = resolveMotivationUnitCost(kind, priceMap);
    const spend = unitCost * intensity;
    totalCost += spend;

    const priceId = MOTIVATION_PRICE_IDS[kind];
    if (priceId) {
      lineItems.push({
        category: "motivation",
        id: priceId,
        motivationKind: kind,
        family: resolveMotivationFamily(kind),
        label: `motivation:${kind}`,
        quantity: intensity,
        unitCostTokens: unitCost,
        spendTokens: spend,
      });
    }
  }

  return { cost: totalCost, lineItems };
}

/**
 * Build PriceList items for all motivation kinds.
 * Useful for seeding a PriceList artifact with motivation entries.
 *
 * @returns {Array<{id:string, kind:string, costTokens:number, description:string}>}
 */
export function buildMotivationPriceListItems() {
  return Object.entries(MOTIVATION_PRICE_IDS).map(([kind, id]) => ({
    id,
    kind: MOTIVATION_PRICE_KIND,
    costTokens: DEFAULT_MOTIVATION_COSTS[kind] || 0,
    description: `Motivation: ${kind}`,
  }));
}

/**
 * Reverse map: motivation kind string → core-ts code (1-based).
 * Matches MOTIVATION_KIND_BY_CODE in core-ts. This is codebook data (live
 * consumer: configurator/motivation-evaluation-core.js), not pricing.
 */
export const MOTIVATION_KIND_TO_CODE = Object.freeze({
  random: 1,
  stationary: 2,
  exploring: 3,
  patrolling: 4,
  attacking: 5,
  defending: 6,
  stealthy: 7,
  friendly: 8,
  reflexive: 9,
  goal_oriented: 10,
  strategy_focused: 11,
  user_controlled: 12,
});

// calculateMotivationStackCostFromCore was deleted in P1.2 (Persona
// Enforcement Program): it was the ONLY reachable path into core-ts's
// motivation cost surface, and nothing outside its own module ever called it.
// Core's cost accumulator went with it. Pricing resolves exclusively through
// calculateMotivationStackCost above.
