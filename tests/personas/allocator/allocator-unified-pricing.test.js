/**
 * P1.4 — ONE PRICE MODEL (Persona Enforcement Program, local-codex/Plan.md)
 *
 * Maintainer decision 2026-07-19: the Allocator price list is canonical.
 * Every charging site prices from it; silent fallbacks are gone — a missing
 * price entry is a structured error, never a quiet default.
 *
 * The census card (see allocator-price-census.test.js) under the unified
 * model: vitals 28 + regen 5 (quadratic at list unit 1) + affinity 39
 * (10 base + 2² stacks + 25 emit) + motivations 5 (2+3) = 77 — down from
 * 119 (old actor model with list) and 236 (old empty-map fallback).
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/";

const CARD = Object.freeze({
  vitals: {
    health: { max: 10, regen: 2 },
    mana: { max: 8, regen: 1 },
    stamina: { max: 6 },
    durability: { max: 4 },
  },
  affinities: [{ kind: "water", expression: "emit", stacks: 2 }],
  motivations: [{ kind: "exploring" }, { kind: "attacking" }],
});

// The canonical map shape is the ITEM map (normalizePriceItems /
// pricing.priceMap()) — items carry the formula, so quadratic ids price
// correctly. Bare-number maps (buildPriceMap) are accepted but price linearly.
async function fullPriceMap() {
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}allocator/validate-spend.js`);
  return normalizePriceItems(buildDefaultPriceList());
}

// ── Actor costing prices from the list ──

test("unified: the census card costs 77, every line from the price list", async () => {
  const { calculateActorConfigurationUnitCost } = await import(`${P}configurator/spend-proposal.js`);
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap: await fullPriceMap() });
  assert.equal(r.errors, undefined);
  assert.equal(r.cost, 77);
  const by = (id) => r.detail.lineItems.find((l) => l.id === id);
  // Regen is quadratic per the list's formula: 1 × 2² = 4, 1 × 1² = 1.
  assert.equal(by("vital_health_regen_tick").spendTokens, 4);
  assert.equal(by("vital_mana_regen_tick").spendTokens, 1);
  // Affinity prices from list ids, not cost-model math: 10 + 4 + 25 = 39.
  const affinity = r.detail.lineItems.filter((l) => l.category === "affinity");
  assert.equal(affinity.reduce((s, l) => s + l.spendTokens, 0), 39);
  // Motivations from the list: 2 + 3.
  assert.equal(by("motivation_exploring").spendTokens, 2);
  assert.equal(by("motivation_attacking").spendTokens, 3);
});

test("unified: an INCOMPLETE price map is a structured error, not a fallback", async () => {
  const { calculateActorConfigurationUnitCost } = await import(`${P}configurator/spend-proposal.js`);
  const map = await fullPriceMap();
  map.delete("vital:vital_health_regen_tick");
  map.delete("motivation:motivation_exploring");
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap: map });
  assert.ok(Array.isArray(r.errors) && r.errors.length >= 2, "errors reported");
  assert.ok(r.errors.some((e) => /vital_health_regen_tick/.test(e)));
  assert.ok(r.errors.some((e) => /motivation_exploring/.test(e)));
});

test("unified: an EMPTY price map errors on every priced component (the old 236-token fallback is dead)", async () => {
  const { calculateActorConfigurationUnitCost } = await import(`${P}configurator/spend-proposal.js`);
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap: new Map() });
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
  assert.notEqual(r.cost, 236, "the fallback economy must not resurface");
});

// ── Motivation policy is fail-loud ──

test("unified: resolveMotivationUnitCost returns null on a miss; stack cost reports errors", async () => {
  const { resolveMotivationUnitCost, calculateMotivationStackCost } = await import(`${P}allocator/motivation-price-policy.js`);
  const map = await fullPriceMap();
  assert.equal(resolveMotivationUnitCost("exploring", map), 2);
  map.delete("motivation:motivation_exploring");
  assert.equal(resolveMotivationUnitCost("exploring", map), null);
  const r = calculateMotivationStackCost([{ kind: "exploring" }, { kind: "attacking" }], map);
  assert.equal(r.cost, 3, "attacking still priced; exploring errored, not defaulted");
  assert.ok(r.errors.some((e) => /exploring/.test(e)));
});

test("unified: the fallback exports are gone", async () => {
  const policy = await import(`${P}allocator/motivation-price-policy.js`);
  assert.equal(policy.DEFAULT_MOTIVATION_COSTS, undefined);
  assert.equal(policy.buildMotivationPriceListItems, undefined);
});

// ── The maximizer prices regen from the list ──

test("unified: maximizeActorBudget buys regen at list prices (quadratic unit 1), not 12/5/4/10", async () => {
  const { maximizeActorBudget } = await import(`${P}configurator/budget-maximizer.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const blank = () => ({ current: 0, max: 0, regen: 0 });
  const [a] = maximizeActorBudget({
    actors: [{ id: "a1", vitals: { health: blank(), mana: blank(), stamina: blank(), durability: blank() } }],
    remaining: 100,
    priceList: buildDefaultPriceList(),
  });
  // 25-token regen budget split 4 ways ≈ 6 each; at unit 1 quadratic,
  // floor(√6) = 2 regen per vital — the maximizer finally affords what the
  // receipt actually charges.
  for (const key of ["health", "mana", "stamina", "durability"]) {
    assert.equal(a.vitals[key].regen, 2, `${key} regen at list price`);
  }
});

// ## TODO: Test Permutations
// - affinityCostScale (room cards) applied to list-priced affinity aggregate
// - expression variants push/pull → externalize/internalize (35) at the new site
// - card with zero-cost motivation (stationary, 0) — priced entry, no error
// - maximizer with a custom list where regen unit > 1: n = floor(√(allotment/unit))
// - validateSpend receipt for a delver card equals the unified card cost
