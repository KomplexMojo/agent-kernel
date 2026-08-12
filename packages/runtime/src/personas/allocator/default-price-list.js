const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";

/**
 * Canonical default price list for agent-kernel simulations.
 *
 * Base unit: 1 point of health = 1 token.
 * Scaling rules:
 *   - Vitals (max points): linear — 1 token per point
 *   - Regen (per-tick rate): quadratic — n units costs n² tokens
 *   - Affinity stacks: quadratic — n stacks costs n² tokens
 *   - Everything else: linear at the listed unitCost
 *
 * "formula" field on each item tells consumers how to compute totalCost:
 *   "linear":    totalCost = unitCost × quantity
 *   "quadratic": totalCost = unitCost × quantity²
 */
const DEFAULT_ITEMS = [
  // --- Vitals (linear, 1 token per point) ---
  { id: "vital_health_point",    kind: "vital", unitCost: 1, formula: "linear",    description: "1 point of max health (base unit: 1 health = 1 token)" },
  { id: "vital_mana_point",      kind: "vital", unitCost: 1, formula: "linear",    description: "1 point of max mana" },
  { id: "vital_stamina_point",   kind: "vital", unitCost: 1, formula: "linear",    description: "1 point of max stamina" },
  { id: "vital_durability_point",kind: "vital", unitCost: 1, formula: "linear",    description: "1 point of max durability" },

  // --- Regen (quadratic: n units/tick costs n² tokens) ---
  { id: "vital_health_regen_tick",    kind: "vital", unitCost: 1, formula: "quadratic", description: "Health regen rate — n regen/tick costs n² tokens" },
  { id: "vital_mana_regen_tick",      kind: "vital", unitCost: 1, formula: "quadratic", description: "Mana regen rate — n regen/tick costs n² tokens" },
  { id: "vital_stamina_regen_tick",   kind: "vital", unitCost: 1, formula: "quadratic", description: "Stamina regen rate — n regen/tick costs n² tokens" },
  { id: "vital_durability_regen_tick",kind: "vital", unitCost: 1, formula: "quadratic", description: "Durability regen rate — n regen/tick costs n² tokens" },

  // --- Affinities (stack cost is quadratic; expressions and base are linear) ---
  { id: "affinity_stack",                     kind: "affinity", unitCost: 1,  formula: "quadratic", description: "Affinity stack — n stacks costs n² tokens" },
  { id: "affinity_base",                      kind: "affinity", unitCost: 10, formula: "linear",    description: "Base cost to add any affinity kind" },
  { id: "affinity_expression_externalize",    kind: "affinity", unitCost: 35, formula: "linear",    description: "External expression (push/pull)" },
  { id: "affinity_expression_internalize",    kind: "affinity", unitCost: 35, formula: "linear",    description: "External expression (internalize/pull)" },
  { id: "affinity_expression_localized",      kind: "affinity", unitCost: 25, formula: "linear",    description: "Internal expression (emit/localized)" },
  { id: "affinity_expression_sustain",        kind: "affinity", unitCost: 25, formula: "linear",    description: "Internal expression (draw/sustain)" },

  // --- Motivations (linear flat costs) ---
  { id: "motivation_stationary",       kind: "motivation", unitCost: 0,  formula: "linear", description: "Stationary — no movement cost" },
  { id: "motivation_random",           kind: "motivation", unitCost: 1,  formula: "linear", description: "Random movement" },
  { id: "motivation_exploring",        kind: "motivation", unitCost: 2,  formula: "linear", description: "Exploring" },
  { id: "motivation_patrolling",       kind: "motivation", unitCost: 3,  formula: "linear", description: "Patrolling" },
  { id: "motivation_attacking",        kind: "motivation", unitCost: 3,  formula: "linear", description: "Attacking posture" },
  { id: "motivation_defending",        kind: "motivation", unitCost: 2,  formula: "linear", description: "Defending posture" },
  { id: "motivation_stealthy",         kind: "motivation", unitCost: 4,  formula: "linear", description: "Stealthy posture" },
  { id: "motivation_friendly",         kind: "motivation", unitCost: 1,  formula: "linear", description: "Friendly posture" },
  { id: "motivation_reflexive",        kind: "motivation", unitCost: 1,  formula: "linear", description: "Reflexive cognition" },
  { id: "motivation_goal_oriented",    kind: "motivation", unitCost: 5,  formula: "linear", description: "Goal-oriented cognition" },
  { id: "motivation_strategy_focused", kind: "motivation", unitCost: 10, formula: "linear", description: "Strategy-focused cognition" },

  // --- Actor spawn ---
  { id: "actor_spawn", kind: "actor", unitCost: 5, formula: "linear", description: "Spawn one actor (delver or warden)" },

  // --- Floor tiles (rooms are priced by component; tiles are atomic) ---
  { id: "tile_floor",   kind: "tile", unitCost: 1, formula: "linear", description: "One floor tile" },
  { id: "tile_hallway", kind: "tile", unitCost: 3, formula: "linear", description: "One hallway tile (more complex pathing)" },

  // --- Hazards ---
  { id: "hazard_basic", kind: "hazard", unitCost: 5, formula: "linear", description: "Basic hazard placement" },

  // --- Hazards (mana-powered; base cost excludes mana vital which is priced separately) ---
  { id: "hazard_base", kind: "hazard", unitCost: 10, formula: "linear", description: "Base hazard instantiation cost" },

  // --- Resources ---
  // consumable=1×, level=5×, permanent=10× the resource's vital grant value
  { id: "resource_base",      kind: "resource", unitCost: 1,  formula: "linear", description: "Consumable resource — costs same as its vital grant value" },
  { id: "resource_level",     kind: "resource", unitCost: 5,  formula: "linear", description: "Level-scoped resource — 5× vital grant value" },
  { id: "resource_permanent", kind: "resource", unitCost: 10, formula: "linear", description: "Permanent resource — 10× vital grant value" },
];

/**
 * Returns a fresh default PriceList artifact.
 * The caller may override meta fields; items are canonical and must not be mutated.
 */
export function buildDefaultPriceList({ meta } = {}) {
  return {
    schema: PRICE_LIST_SCHEMA,
    schemaVersion: 1,
    meta: meta || {
      id: "default-price-list-v1",
      runId: "system",
      createdAt: new Date().toISOString(),
      producedBy: "allocator",
      note: "Canonical default price list. Base unit: 1 health point = 1 token.",
    },
    items: DEFAULT_ITEMS,
  };
}

/** Resolves the formula for a price list item, defaulting to "linear". */
export function resolveFormula(item) {
  return item?.formula === "quadratic" ? "quadratic" : "linear";
}

/**
 * Computes the effective token cost for a price list item given a quantity,
 * applying the item's formula (linear or quadratic).
 *   linear:    unitCost × quantity
 *   quadratic: unitCost × quantity²
 */
export function applyFormula(item, quantity) {
  const q = typeof quantity === "number" && quantity > 0 ? quantity : 1;
  const formula = resolveFormula(item);
  const unitCost = typeof item?.unitCost === "number" ? item.unitCost : 0;
  return formula === "quadratic" ? unitCost * q * q : unitCost * q;
}
