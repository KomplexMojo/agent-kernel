import { VITAL_KEYS } from "../../contracts/domain-constants.js";
import { buildPriceMap, normalizePriceItems } from "../allocator/validate-spend.js";

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

function getUnitCost(priceMap, kind, id, fallback) {
  const val = priceMap.get(`${kind}:${id}`);
  return Number.isFinite(val) && val >= 0 ? val : fallback;
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
 */
export function maximizeActorBudget({ actors, remaining, priceList }) {
  if (!Array.isArray(actors) || actors.length === 0) return actors;
  const budget = typeof remaining === "number" ? Math.floor(remaining) : 0;
  if (budget <= 0) return actors;

  const priceMap = buildPriceMap(priceList);
  const priceItems = normalizePriceItems(priceList);

  const scalableIndices = actors
    .map((a, i) => (a?.vitals && typeof a.vitals === "object" ? i : -1))
    .filter((i) => i >= 0);
  if (scalableIndices.length === 0) return actors;

  const cloned = actors.map(cloneActor);

  const vitalEntries = VITAL_DISTRIBUTION_ORDER
    .map((key) => ({
      key,
      unitCost: getUnitCost(priceMap, "vital", VITAL_POINT_IDS[key], 1),
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
    const item = priceItems.get(`vital:${VITAL_REGEN_IDS[key]}`);
    const unit = item && Number.isFinite(item.unitCost) && item.unitCost > 0 ? item.unitCost : null;
    const allotment = perRegenVital + (regenVitalRemainder-- > 0 ? 1 : 0);
    if (allotment <= 0 || unit === null) continue;
    const quadratic = item.formula === "quadratic";

    const perActorAllotment = Math.floor(allotment / scalableIndices.length);
    let actorAllocRemainder = allotment - perActorAllotment * scalableIndices.length;

    scalableIndices.forEach((actorIdx) => {
      const actorAllotment = perActorAllotment + (actorAllocRemainder-- > 0 ? 1 : 0);
      const n = quadratic
        ? Math.floor(Math.sqrt(actorAllotment / unit))
        : Math.floor(actorAllotment / unit);
      if (n <= 0) return;
      const spent = quadratic ? unit * n * n : unit * n;
      cloned[actorIdx].vitals[key].regen += n;
      regenLeftover -= spent;
    });
  }

  // Phase 3: recycle unspent regen budget (quadratic rounding) into vital max points
  if (regenLeftover > 0) {
    distributeVitalPoints(cloned, scalableIndices, vitalEntries, regenLeftover);
  }

  return cloned;
}
