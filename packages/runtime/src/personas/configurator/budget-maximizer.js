import { VITAL_KEYS } from "../../contracts/domain-constants.js";

const VITAL_POINT_IDS = Object.freeze({
  health: "vital_health_point",
  mana: "vital_mana_point",
  stamina: "vital_stamina_point",
  durability: "vital_durability_point",
});

const VITAL_REGEN_IDS = Object.freeze({
  health: "vital_health_regen_tick",
  mana: "vital_mana_regen_tick",
  stamina: "vital_stamina_regen_tick",
  durability: "vital_durability_regen_tick",
});

// Distribute evenly across all four vitals; health and durability lead the order
const VITAL_DISTRIBUTION_ORDER = ["health", "durability", "mana", "stamina"];

/**
 * Read a price the Allocator published, or refuse.
 *
 * WP-5/D10: this used to take a `fallback` and return it whenever the price was
 * absent — and every caller passed `1`, which is exactly what the Allocator's
 * default list charges for a vital point. The fallback and the real price agreed
 * numerically, so the Configurator pricing on its own was **indistinguishable in
 * output** from the Configurator asking the Allocator. That is a price constant
 * living in the wrong persona, hidden by a coincidence.
 *
 * The charter rule is "all pricing goes through the Allocator, no silent
 * fallbacks", so a missing price is a defect in the price list — the Allocator
 * owns its completeness — and the only honest response is to name it and stop.
 */
function requireUnitCost(unitCosts, kind, id) {
  const key = `${kind}:${id}`;
  const val = unitCosts.get(key);
  if (!Number.isFinite(val) || val < 0) {
    throw new Error(
      `budget-maximizer: the Allocator published no unit cost for "${key}"; `
      + "pricing is the Allocator's to state and the Configurator will not assume one.",
    );
  }
  return val;
}

function cloneActor(actor) {
  const clone = { ...actor };
  if (actor.vitals && typeof actor.vitals === "object") {
    clone.vitals = {};
    for (const key of VITAL_KEYS) {
      const v = actor.vitals[key];
      clone.vitals[key] = v ? { ...v } : { current: 0, max: 0, regen: 0 };
    }
  }
  return clone;
}

function distributeVitalPoints(cloned, scalableIndices, vitalEntries, budget) {
  let left = budget;
  const perVital = Math.floor(left / vitalEntries.length);
  let vitalRemainder = left - perVital * vitalEntries.length;

  for (const { key, unitCost } of vitalEntries) {
    if (left <= 0) break;
    const allotment = perVital + (vitalRemainder-- > 0 ? 1 : 0);
    if (allotment <= 0) continue;

    const totalPoints = Math.floor(allotment / unitCost);
    if (totalPoints === 0) continue;

    const perActor = Math.floor(totalPoints / scalableIndices.length);
    let actorRemainder = totalPoints - perActor * scalableIndices.length;

    scalableIndices.forEach((actorIdx) => {
      const add = perActor + (actorRemainder-- > 0 ? 1 : 0);
      if (add <= 0) return;
      const v = cloned[actorIdx].vitals[key];
      v.max += add;
      v.current = v.max;
      left -= add * unitCost;
    });
  }

  return left;
}

/**
 * Scales actor vitals and regen to exhaust `remaining` unspent budget tokens.
 * 75% of budget goes to vital max points; 25% goes to regen, priced by the
 * price list's own formula (P1.4: quadratic at the list unit — the maximizer
 * budgets exactly what the receipt will charge).
 * Regen budget leftover from rounding is recycled into a final vitals pass.
 *
 * WP-5/D10: takes the Allocator's PUBLISHED pricing rather than a raw PriceList.
 * This module used to import `buildPriceMap`/`normalizePriceItems` out of
 * `allocator/validate-spend.js` and derive the maps itself — the Configurator
 * reaching into the Allocator for pricing tools, which is the crossing this
 * change removes. Callers now pass what `createAllocatorPersona().pricing`
 * publishes:
 *
 *   unitCosts  <- pricing.unitCosts()   Map "kind:id" -> unit cost number
 *   priceItems <- pricing.priceMap()    Map "kind:id" -> { unitCost, formula }
 *
 * Assembly stays here (CR.9: the Configurator authors); only the prices are the
 * Allocator's, and they are required rather than defaulted.
 */
export function maximizeActorBudget({ actors, remaining, unitCosts, priceItems }) {
  if (!Array.isArray(actors) || actors.length === 0) return actors;
  const budget = typeof remaining === "number" ? Math.floor(remaining) : 0;
  if (budget <= 0) return actors;

  if (!(unitCosts instanceof Map)) {
    throw new Error(
      "budget-maximizer: unitCosts must be the Allocator's published price map "
      + "(createAllocatorPersona().pricing.unitCosts()).",
    );
  }
  if (!(priceItems instanceof Map)) {
    throw new Error(
      "budget-maximizer: priceItems must be the Allocator's published price items "
      + "(createAllocatorPersona().pricing.priceMap()).",
    );
  }

  const scalableIndices = actors
    .map((a, i) => (a?.vitals && typeof a.vitals === "object" ? i : -1))
    .filter((i) => i >= 0);
  if (scalableIndices.length === 0) return actors;

  const cloned = actors.map(cloneActor);

  const vitalEntries = VITAL_DISTRIBUTION_ORDER
    .map((key) => ({
      key,
      unitCost: requireUnitCost(unitCosts, "vital", VITAL_POINT_IDS[key]),
    }))
    .filter(({ unitCost }) => unitCost > 0);

  if (vitalEntries.length === 0) return cloned;

  const vitalBudget = Math.floor(budget * 0.75);
  const regenBudget = budget - vitalBudget;

  // Phase 1: distribute vital max points
  distributeVitalPoints(cloned, scalableIndices, vitalEntries, vitalBudget);

  // Phase 2: distribute regen priced by the list's formula.
  // quadratic: cost(n) = unit·n² → max n = floor(√(allotment/unit))
  // linear:    cost(n) = unit·n  → max n = floor(allotment/unit)
  let regenLeftover = regenBudget;
  const perRegenVital = Math.floor(regenBudget / VITAL_DISTRIBUTION_ORDER.length);
  let regenVitalRemainder = regenBudget - perRegenVital * VITAL_DISTRIBUTION_ORDER.length;

  for (const key of VITAL_DISTRIBUTION_ORDER) {
    const regenKey = `vital:${VITAL_REGEN_IDS[key]}`;
    const item = priceItems.get(regenKey);
    // An ABSENT price is a refusal (see requireUnitCost): the old code skipped
    // the vital silently, so an incomplete price list quietly bought no regen at
    // all instead of reporting that it could not be priced. A price that exists
    // and is zero or negative is a different thing — the Allocator saying this is
    // not purchasable — and that is still a legitimate skip.
    if (!item || !Number.isFinite(item.unitCost)) {
      throw new Error(
        `budget-maximizer: the Allocator published no price for "${regenKey}"; `
        + "pricing is the Allocator's to state and the Configurator will not assume one.",
      );
    }
    const unit = item.unitCost > 0 ? item.unitCost : null;
    const allotment = perRegenVital + (regenVitalRemainder-- > 0 ? 1 : 0);
    if (allotment <= 0 || unit === null) continue;
    const quadratic = item.formula === "quadratic";

    const perActorAllotment = Math.floor(allotment / scalableIndices.length);
    let actorAllocRemainder = allotment - perActorAllotment * scalableIndices.length;

    scalableIndices.forEach((actorIdx) => {
      const actorAllotment = perActorAllotment + (actorAllocRemainder-- > 0 ? 1 : 0);
      // A quadratic price is quadratic in the vital's TOTAL regen, not in the increment bought
      // here. Raising an actor already at `base` by n costs unit·((base+n)² − base²), which exceeds
      // the unit·n² this used to budget by exactly unit·2·base·n — so the maximizer under-budgeted
      // every regen purchase on any vital that did not start at zero, and the receipt then charged
      // the difference. It went unseen because the three vitals it touched all started at 0, where
      // (0+n)² − 0² = n² and the wrong formula is accidentally right. Stamina did not: it carries a
      // movement floor, which is why `create --text "…maximize…"` already overspent its pool by 28
      // tokens at 600 and 72 at 1000 before any of this. The actor viability floor put health, mana
      // and durability above zero too, turning an occasional overshoot into a constant one.
      const base = cloned[actorIdx].vitals[key].regen;
      const n = quadratic
        // unit·((base+n)² − base²) ≤ A  ⇔  n ≤ √(A/unit + base²) − base
        ? Math.floor(Math.sqrt(actorAllotment / unit + base * base) - base)
        : Math.floor(actorAllotment / unit);
      if (n <= 0) return;
      const spent = quadratic ? unit * ((base + n) * (base + n) - base * base) : unit * n;
      cloned[actorIdx].vitals[key].regen = base + n;
      regenLeftover -= spent;
    });
  }

  // Phase 3: recycle unspent regen budget (quadratic rounding) into vital max points
  if (regenLeftover > 0) {
    distributeVitalPoints(cloned, scalableIndices, vitalEntries, regenLeftover);
  }

  return cloned;
}
