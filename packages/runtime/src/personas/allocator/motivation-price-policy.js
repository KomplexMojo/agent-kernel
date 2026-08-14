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
import { MOTIVATION_FAMILIES } from "../../contracts/domain-constants.js";

// Motivation families come from contracts/domain-constants.js. This module used to
// hand-maintain its OWN copy — byte-identical, but a real duplicate rather than an
// alias, so it could silently diverge — and its comment named
// motivation-loadouts.js as the source of truth, which was itself only an alias of
// contracts/game-elements.js. Found by the G2 single-origin guard the moment its
// pattern was broadened (P5.1 D2), not by reading. Where a guard can enumerate,
// prefer it to reading.

/**
 * Motivation tier classification (design §6.6). Classification only — tier
 * PRICES were removed in P1.4: the price list is the single pricing source
 * and a missing entry is a structured error, never a fallback.
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
 * Resolve the unit cost for a single motivation kind from the price list.
 *
 * FAIL-LOUD (P1.4): there is no fallback. A missing or invalid entry returns
 * null and the caller must surface it as an error.
 *
 * @param {string} kind - The motivation kind (e.g. "reflexive").
 * @param {Map<string,number>} [priceMap] - Map from "kind:id" → costTokens.
 * @returns {number|null} The resolved unit cost (>= 0), or null when the
 *   price list has no usable entry for this kind.
 */
export function resolveMotivationUnitCost(kind, priceMap) {
  const priceId = MOTIVATION_PRICE_IDS[kind];
  if (priceMap && priceId) {
    const key = `${MOTIVATION_PRICE_KIND}:${priceId}`;
    const fromList = priceMap.get(key);
    // Accept both map shapes: a bare unitCost number (buildPriceMap) or a
    // price item object (normalizePriceItems). Motivations are linear either way.
    const unit = fromList && typeof fromList === "object" ? fromList.unitCost : fromList;
    if (Number.isFinite(unit) && unit >= 0) {
      return unit;
    }
  }
  return null;
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
 * FAIL-LOUD (P1.4): kinds without a price list entry contribute no cost and
 * are reported in `errors` — never silently defaulted.
 *
 * @param {Array<{kind:string, intensity?:number}>} motivations
 * @param {Map<string,number>} [priceMap]
 * @returns {{cost:number, lineItems:Array, errors?:string[]}}
 */
export function calculateMotivationStackCost(motivations, priceMap) {
  const lineItems = [];
  const errors = [];
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
    if (unitCost === null) {
      errors.push(`motivation "${kind}" has no price list entry (expected ${MOTIVATION_PRICE_KIND}:${MOTIVATION_PRICE_IDS[kind] || "?"})`);
      continue;
    }
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

  return { cost: totalCost, lineItems, ...(errors.length ? { errors } : {}) };
}

// buildMotivationPriceListItems was deleted in P1.4: it seeded PriceList
// artifacts from the fallback tier table (25/50/10), which contradicted the
// canonical price list (2/3/…). The default price list in
// default-price-list.js already carries every motivation entry.

// MOTIVATION_KIND_TO_CODE moved to contracts/domain-constants.js (P5.1 D1).
// The comment that used to sit here said it plainly — "this is codebook data
// (live consumer: configurator/motivation-evaluation-core.js), not pricing" — so
// it had no business in the Allocator, and the Configurator had to cross a
// persona boundary to read it. It is now DERIVED from GAME_MOTIVATION_KINDS
// order rather than hand-listed, which was verified to produce a byte-identical
// map and retires 12 pairs that had to stay in sync with an array by convention.

// calculateMotivationStackCostFromCore was deleted in P1.2 (Persona
// Enforcement Program): it was the ONLY reachable path into core-ts's
// motivation cost surface, and nothing outside its own module ever called it.
// Core's cost accumulator went with it. Pricing resolves exclusively through
// calculateMotivationStackCost above.
