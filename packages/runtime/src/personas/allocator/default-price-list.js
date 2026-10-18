import { PERSONA_IDS, stampPersona } from "../_shared/persona-stamp.js";
import { UNUSED_CLOCK } from "../_shared/require-clock.js";

import BASE_COSTS from "./base-costs.json" with { type: "json" };
import { playablePremiumFromUnitCosts } from "./motivation-price-policy.js";
import { PRICE_LIST_SCHEMA } from "../../contracts/artifacts.ts";


/**
 * Canonical default price list for agent-kernel simulations.
 *
 * DATA vs LOGIC: the base costs live in `base-costs.json` and are tunable there.
 * The formulas that consume them live HERE, in code:
 *   - which ids scale quadratically (QUADRATIC_IDS) or triangularly (TRIANGULAR_IDS)
 *   - the resource free-floating premium (buildResourceItems)
 * Edit numbers in the JSON; edit maths here.
 *
 * Base unit: 1 point of health = 1 token.
 * Scaling rules:
 *   - Vitals (max points): linear — 1 token per point
 *   - Regen (per-tick rate): quadratic — n units costs n² tokens
 *   - Affinity stacks: quadratic — n stacks costs n² tokens
 *   - Affinity slots: triangular — the nth slot opened costs n × unitCost, so n slots
 *     cost unitCost × n(n+1)/2 (maintainer, 2026-10-14)
 *   - Everything else: linear at the listed unitCost
 *
 * "formula" field on each emitted item tells consumers how to compute totalCost:
 *   "linear":    totalCost = unitCost × quantity
 *   "quadratic": totalCost = unitCost × quantity²
 *   "triangular": totalCost = unitCost × quantity(quantity+1)/2
 */

/** Ids whose quantity scales quadratically. This is logic, not data. */
const QUADRATIC_IDS = new Set([
  "vital_health_regen_tick",
  "vital_mana_regen_tick",
  "vital_stamina_regen_tick",
  "vital_durability_regen_tick",
  "affinity_range",
  "affinity_intensity",
]);

/** Ids whose quantity scales triangularly: each further unit costs one unitCost more. */
const TRIANGULAR_IDS = new Set([
  "resource_affinity_slot",
]);

function formulaFor(id) {
  if (QUADRATIC_IDS.has(id)) return "quadratic";
  if (TRIANGULAR_IDS.has(id)) return "triangular";
  return "linear";
}

/**
 * Human-readable descriptions only. The NUMBERS live in base-costs.json —
 * this map must never carry a cost, or the base costs would have two homes again.
 */
const DESCRIPTIONS = {
  "vital_health_point": "1 point of max health (base unit: 1 health = 1 token)",
  "vital_mana_point": "1 point of max mana",
  "vital_stamina_point": "1 point of max stamina",
  "vital_durability_point": "1 point of max durability",
  "vital_health_regen_tick": "Health regen rate — n regen/tick costs n² tokens",
  "vital_mana_regen_tick": "Mana regen rate — n regen/tick costs n² tokens",
  "vital_stamina_regen_tick": "Stamina regen rate — n regen/tick costs n² tokens",
  "vital_durability_regen_tick": "Durability regen rate — n regen/tick costs n² tokens",
  "affinity_range": "Affinity range — r tiles of reach costs r² units (#340)",
  "affinity_intensity": "Affinity intensity — strength i costs i² units (#340)",
  "affinity_base": "Base cost to add any affinity kind",
  "affinity_expression_externalize": "External expression (push/pull)",
  "affinity_expression_internalize": "External expression (internalize/pull)",
  "affinity_expression_localized": "Internal expression (emit/localized)",
  "affinity_expression_sustain": "Internal expression (draw/sustain)",
  "motivation_stationary": "Stationary — no movement cost",
  "motivation_random": "Random movement",
  "motivation_exploring": "Exploring",
  "motivation_patrolling": "Patrolling",
  "motivation_attacking": "Attacking posture",
  "motivation_defending": "Defending posture",
  "motivation_stealthy": "Stealthy posture",
  "motivation_friendly": "Friendly posture",
  "motivation_reflexive": "Reflexive cognition",
  "motivation_goal_oriented": "Goal-oriented cognition",
  "motivation_strategy_focused": "Strategy-focused cognition",
  "motivation_user_controlled": "Playable control — the dearest autonomous motivation stack + 1",
  "actor_spawn": "Spawn one actor (delver or warden)",
  "tile_floor": "One floor tile",
  "tile_hallway": "One hallway/connector tile — walkable area, priced as a floor tile",
  // CR.9 M5: `hazard_base` (10) was deleted. `hazard_basic` (5) is the enforced base every
  // hazard pays; `hazard_base` was a second id for the same idea, published for the life of
  // the branch and charged by nothing. Two names for one charge is the CR.1 shape, and a
  // price nothing spends is dead vocabulary — the census in
  // tests/personas/allocator/allocator-everything-costs.test.js now fails on both.
  "hazard_basic": "Basic hazard placement — the base every hazard pays",
  "resource_base": "Consumable resource — costs same as its vital grant value",
  "resource_level": "Level-scoped resource — 5× vital grant value",
  "resource_permanent": "Permanent resource — 10× vital grant value",
  "resource_affinity_slot": "Slot-unlock loot — opens one more affinity slot; the most valuable loot",
};

function itemFrom(id, unitCost, description) {
  return {
    id,
    kind: KIND_BY_GROUP[GROUP_BY_ID[id]] || "misc",
    unitCost,
    formula: formulaFor(id),
    ...(description ? { description } : {}),
  };
}

const GROUP_BY_ID = {};
// The JSON groups that ARE the price list. Other groups in base-costs.json
// (actorModel, motivationFallback) hold numbers for models consumed elsewhere
// (cost-model.js, motivation-price-policy.js) and must NOT become list items.
const KIND_BY_GROUP = {
  vitals: "vital",
  regen: "vital",
  affinity: "affinity",
  motivation: "motivation",
  actor: "actor",
  tile: "tile",
  hazard: "hazard",
  resource: "resource",
};
for (const [group, entries] of Object.entries(BASE_COSTS)) {
  if (!(group in KIND_BY_GROUP) || typeof entries !== "object") continue;
  for (const id of Object.keys(entries)) GROUP_BY_ID[id] = group;
}

/**
 * Resource-specific items carrying the free-floating premium.
 *
 * A resource is unattached: it sits on the floor and grants its payload to
 * whichever actor walks over it. That is worth a premium over the same payload
 * bolted to one specific actor — so resource_* ids cost `premium × base`, rounded
 * to whole tokens (every other cost in this system is an integer).
 *
 * Hazards are deliberately NOT premiumed: a hazard only threatens, it grants
 * nothing, so the two are not symmetric.
 *
 * The premium is the ONLY thing these ids add. Their quadratic/linear behaviour is
 * inherited from the id they mirror, so a resource's affinity stacks scale exactly
 * like an actor's.
 */
function buildResourceItems() {
  const premium = BASE_COSTS.freeFloatingPremium;
  const mirrored = [
    ...Object.keys(BASE_COSTS.affinity),
    ...Object.keys(BASE_COSTS.vitals),
    ...Object.keys(BASE_COSTS.regen),
  ];
  return mirrored.map((baseId) => {
    const group = GROUP_BY_ID[baseId];
    const base = BASE_COSTS[group][baseId];
    const id = `resource_${baseId}`;
    return {
      id,
      kind: "resource",
      unitCost: Math.round(base * premium),
      // Mirror the base id's scaling — premium changes price, never shape.
      formula: formulaFor(baseId),
      description: `${DESCRIPTIONS[baseId] || baseId} — free-floating resource (${premium}× ${base}, rounded)`,
    };
  });
}

const DEFAULT_ITEMS = [
  ...Object.entries(BASE_COSTS)
    .filter(([group, entries]) => group in KIND_BY_GROUP && typeof entries === "object")
    .flatMap(([, entries]) =>
      Object.entries(entries).map(([id, unitCost]) => itemFrom(id, unitCost, DESCRIPTIONS[id])),
    ),
  ...buildResourceItems(),
  // The playable premium is a formula over the autonomous motivation prices, so it has no
  // number in base-costs.json; it is listed so receipts and price lists show what it costs.
  {
    ...itemFrom("motivation_user_controlled", playablePremiumFromUnitCosts(BASE_COSTS.motivation),
      DESCRIPTIONS.motivation_user_controlled),
    kind: "motivation",
  },
];

/**
 * Returns a fresh default PriceList artifact.
 * The caller may override meta fields; items are canonical and must not be mutated.
 */
export function buildDefaultPriceList({ meta, createdAt } = {}) {
  return {
    schema: PRICE_LIST_SCHEMA,
    schemaVersion: 1,
    meta: meta ? stampPersona(meta, PERSONA_IDS.allocator) : {
      id: "default-price-list-v1",
      runId: "system",
      // PX.3 (M6): was `new Date().toISOString()`. Bare `buildDefaultPriceList()` is a
      // legitimate, common call — the item list is read without any interest in the meta —
      // so requiring a clock here would be noise. What is NOT acceptable is wall-clock time
      // silently entering a PriceList artifact, so the fallback is the sanctioned
      // deterministic marker instead: greppable via `rg UNUSED_CLOCK`, and it can never
      // make two runs of the same build differ.
      createdAt: createdAt || UNUSED_CLOCK(),
      producedBy: "allocator",
      note: "Canonical default price list. Base unit: 1 health point = 1 token.",
    },
    items: DEFAULT_ITEMS,
  };
}

/** Resolves the formula for a price list item, defaulting to "linear". */
export function resolveFormula(item) {
  return item?.formula === "quadratic" || item?.formula === "triangular" ? item.formula : "linear";
}

/**
 * Computes the effective token cost for a price list item given a quantity,
 * applying the item's formula (linear, quadratic or triangular).
 *   linear:     unitCost × quantity
 *   quadratic:  unitCost × quantity²
 *   triangular: unitCost × quantity(quantity+1)/2
 */
export function applyFormula(item, quantity) {
  const q = typeof quantity === "number" && quantity > 0 ? quantity : 1;
  const formula = resolveFormula(item);
  const unitCost = typeof item?.unitCost === "number" ? item.unitCost : 0;
  if (formula === "quadratic") return unitCost * q * q;
  if (formula === "triangular") return (unitCost * q * (q + 1)) / 2;
  return unitCost * q;
}
