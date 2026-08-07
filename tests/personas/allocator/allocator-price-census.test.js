/**
 * PRICE-MODEL CENSUS — unified (P1.4).
 *
 * P0.1 originally pinned FOUR divergent charging sites (actor model 83 vs
 * list 39 vs resource 61 for the same affinity; silent fallbacks doubling a
 * card from 119 to 236; the maximizer budgeting regen at 12/5/4/10 that the
 * receipt charged at 1). P1.4 (maintainer decision 2026-07-19) made the
 * Allocator price list canonical everywhere, so this census now asserts
 * CONVERGENCE: every site prices the same payload identically, and a missing
 * entry is a structured error, never a fallback.
 *
 * The only sanctioned price difference left is the resource free-floating
 * premium (round(1.5×base)) — a resource GRANTS unattached, so it costs more
 * than the same payload bolted to an actor.
 */
const assert = require("node:assert/strict");
// CR.9 M3: the Allocator refuses to price raw motivations without the Configurator's
// vocabulary. Injected here exactly as production injects it.
const { configuratorNormalizeMotivations } = require("../../helpers/configurator-capabilities.js");

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

async function load() {
  const { buildDefaultPriceList, applyFormula } = await import(`${P}allocator/default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}allocator/validate-spend.js`);
  const { calculateMotivationStackCost } = await import(`${P}allocator/motivation-price-policy.js`);
  const { calculateActorConfigurationUnitCost } = await import(`${P}allocator/spend-proposal.js`);
  const normalizeMotivations = await configuratorNormalizeMotivations();
  const { maximizeActorBudget } = await import(`${P}configurator/budget-maximizer.js`);
  const priceList = buildDefaultPriceList();
  return {
    priceList,
    priceMap: normalizePriceItems(priceList),
    item: (id) => priceList.items.find((i) => i.id === id),
    applyFormula,
    calculateMotivationStackCost,
    calculateActorConfigurationUnitCost,
    normalizeMotivations,
    maximizeActorBudget,
  };
}

// ── Site 1: the price list — canonical unit costs and formula shapes ──

test("site 1: price-list unit costs and formulas for the census card's components", async () => {
  const { item, applyFormula } = await load();
  const expect = {
    vital_health_point: { unitCost: 1, formula: "linear", q: 10, total: 10 },
    vital_mana_point: { unitCost: 1, formula: "linear", q: 8, total: 8 },
    vital_stamina_point: { unitCost: 1, formula: "linear", q: 6, total: 6 },
    vital_durability_point: { unitCost: 1, formula: "linear", q: 4, total: 4 },
    vital_health_regen_tick: { unitCost: 1, formula: "quadratic", q: 2, total: 4 },
    vital_mana_regen_tick: { unitCost: 1, formula: "quadratic", q: 1, total: 1 },
    affinity_base: { unitCost: 10, formula: "linear", q: 1, total: 10 },
    affinity_stack: { unitCost: 1, formula: "quadratic", q: 2, total: 4 },
    affinity_expression_localized: { unitCost: 25, formula: "linear", q: 1, total: 25 },
    motivation_exploring: { unitCost: 2, formula: "linear", q: 1, total: 2 },
    motivation_attacking: { unitCost: 3, formula: "linear", q: 1, total: 3 },
  };
  for (const [id, e] of Object.entries(expect)) {
    const it = item(id);
    assert.ok(it, `price list defines ${id}`);
    assert.equal(it.unitCost, e.unitCost, `${id} unitCost`);
    assert.equal(it.formula ?? "linear", e.formula, `${id} formula`);
    assert.equal(applyFormula(it, e.q), e.total, `${id} total at q=${e.q}`);
  }
});

// ── Site 2 CONVERGED: actor costing == the list, line for line ──

test("site 2 == site 1: the census card costs 77, every line at list price", async () => {
  const { calculateActorConfigurationUnitCost, priceMap, item, applyFormula, normalizeMotivations } = await load();
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap, normalizeMotivations });
  assert.equal(r.errors, undefined);
  assert.equal(r.cost, 77, "28 vitals + 5 regen + 39 affinity + 5 motivations");
  const by = (id) => r.detail.lineItems.find((l) => l.id === id);
  for (const [id, q] of [
    ["vital_health_point", 10], ["vital_mana_point", 8], ["vital_stamina_point", 6],
    ["vital_durability_point", 4], ["vital_health_regen_tick", 2], ["vital_mana_regen_tick", 1],
    ["motivation_exploring", 1], ["motivation_attacking", 1],
  ]) {
    assert.equal(by(id).spendTokens, applyFormula(item(id), q), `${id} at list price`);
  }
  const affinity = r.detail.lineItems.filter((l) => l.category === "affinity");
  assert.equal(
    affinity.reduce((s, l) => s + l.spendTokens, 0),
    applyFormula(item("affinity_base"), 1)
      + applyFormula(item("affinity_stack"), 2)
      + applyFormula(item("affinity_expression_localized"), 1),
    "actor affinity == list model (39), the 83-token actor model is gone",
  );
});

test("fail-loud: an empty price map yields structured errors, not the old 236-token fallback", async () => {
  const { calculateActorConfigurationUnitCost, normalizeMotivations } = await load();
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap: new Map(), normalizeMotivations });
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0, "errors reported");
  assert.notEqual(r.cost, 236, "fallback economy must not resurface");
});

// ── Site 3 CONVERGED: motivation policy prices from the list or errors ──

test("site 3: motivations cost 5 from the list; a missing entry is an error, never 25", async () => {
  const { calculateMotivationStackCost, priceMap } = await load();
  assert.equal(calculateMotivationStackCost(CARD.motivations, priceMap).cost, 5);
  const r = calculateMotivationStackCost(CARD.motivations, new Map());
  assert.equal(r.cost, 0);
  assert.equal(r.lineItems.length, 0);
  assert.ok(r.errors.length >= 2, "every unpriced kind reported");
});

// ── Site 4 CONVERGED: the maximizer budgets what the receipt charges ──

test("site 4 == site 1: maximizer buys regen at list prices (quadratic, unit 1)", async () => {
  const { maximizeActorBudget, priceList } = await load();
  // WP-5/D10: the maximizer takes the Allocator's PUBLISHED pricing rather than a
  // raw PriceList — it no longer imports the Allocator's price-map builders to
  // derive them itself. Same prices, same expectations; different route.
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { UNUSED_CLOCK } = await import(`${P}_shared/require-clock.js`);
  const { pricing } = createAllocatorPersona({ priceList, clock: UNUSED_CLOCK });
  const blank = () => ({ current: 0, max: 0, regen: 0 });
  const [a] = maximizeActorBudget({
    actors: [{ id: "a1", vitals: { health: blank(), mana: blank(), stamina: blank(), durability: blank() } }],
    remaining: 100,
    unitCosts: pricing.unitCosts(),
    priceItems: pricing.priceMap(),
  });
  // 25-token regen budget split 4 ways ≈ 6 each → floor(√6) = 2 per vital.
  for (const key of ["health", "mana", "stamina", "durability"]) {
    assert.equal(a.vitals[key].regen, 2, `${key} regen affordable at the charged price`);
  }
});

// ── The one sanctioned difference: the resource premium ──

test("resource premium: the same payload costs 39 attached, 61 free-floating — premium, not a second model", async () => {
  const { item, applyFormula } = await load();
  const attached =
    applyFormula(item("affinity_base"), 1)
    + applyFormula(item("affinity_stack"), 2)
    + applyFormula(item("affinity_expression_localized"), 1);
  const resource =
    applyFormula(item("resource_affinity_base"), 1)
    + applyFormula(item("resource_affinity_stack"), 2)
    + applyFormula(item("resource_affinity_expression_localized"), 1);
  assert.equal(attached, 39);
  assert.equal(resource, 61);
  assert.ok(resource > attached, "free-floating costs MORE than attached — absurdity resolved");
  // Premium derivation stays code-enforced: round(1.5 × base) per mirrored id.
  assert.equal(item("resource_affinity_base").unitCost, Math.round(item("affinity_base").unitCost * 1.5));
});

// ## TODO: Test Permutations
// - room-card affinityCostScale against list-priced affinity aggregate
// - push/pull expressions (externalize/internalize, 35) across sites 1+2
// - a custom price list with regen unit 2: site 2 charges 2n², site 4 affords floor(√(A/2))
// - number-map (buildPriceMap) degradation: linear-only pricing documented
