/**
 * P0.1 — PRICE-MODEL CENSUS (Persona Enforcement Program, local-codex/Plan.md)
 *
 * Characterization tests pinning what each of the FOUR live charging sites
 * produces TODAY for one fixed actor card and one fixed resource. These are the
 * guardrails for the Allocator consolidation (P1.x): every migration step must
 * keep this file passing until the step that deliberately changes a number —
 * and that step must update the pin in the same diff, citing the milestone.
 *
 * The four sites (see allocator/README.md "Known divergence"):
 *   1. Allocator price list + applyFormula      — the standard-compliant path
 *   2. spend-proposal calculateActorConfigurationUnitCost — actor/card costing
 *   3. motivation-price-policy calculateMotivationStackCost
 *   4. budget-maximizer maximizeActorBudget
 *
 * Assertions marked DIVERGES are cross-site disagreements pinned deliberately.
 * They are documentation of debt, not endorsement.
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

async function load() {
  const { buildDefaultPriceList, applyFormula } = await import(`${P}allocator/default-price-list.js`);
  const { buildPriceMap } = await import(`${P}allocator/validate-spend.js`);
  const { calculateMotivationStackCost } = await import(`${P}allocator/motivation-price-policy.js`);
  const { calculateActorConfigurationUnitCost } = await import(`${P}configurator/spend-proposal.js`);
  const { maximizeActorBudget } = await import(`${P}configurator/budget-maximizer.js`);
  const priceList = buildDefaultPriceList();
  return {
    priceList,
    priceMap: buildPriceMap(priceList),
    item: (id) => priceList.items.find((i) => i.id === id),
    applyFormula,
    calculateMotivationStackCost,
    calculateActorConfigurationUnitCost,
    maximizeActorBudget,
  };
}

function line(result, id) {
  return result.detail.lineItems.find((l) => l.id === id);
}

// ── Site 1: the Allocator price list — canonical unit costs and formula shapes ──

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

// ── Site 2: actor/card costing — consults the list for some things, not others ──

test("site 2 (full price map): census card costs 119 total", async () => {
  const { calculateActorConfigurationUnitCost, priceMap } = await load();
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap });
  assert.equal(r.cost, 119);
  assert.equal(r.detail.pricingSource, "price-list");
  // Vital max points DO follow the price list (1 token/point).
  assert.equal(line(r, "vital_health_point").spendTokens, 10);
  assert.equal(line(r, "vital_mana_point").spendTokens, 8);
  assert.equal(line(r, "vital_stamina_point").spendTokens, 6);
  assert.equal(line(r, "vital_durability_point").spendTokens, 4);
  // Motivations DO follow the price list.
  assert.equal(line(r, "motivation_exploring").spendTokens, 2);
  assert.equal(line(r, "motivation_attacking").spendTokens, 3);
});

test("DIVERGES site 2 vs site 1: regen charged LINEAR here, quadratic on the list", async () => {
  const { calculateActorConfigurationUnitCost, priceMap } = await load();
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap });
  // List says vital_health_regen_tick is quadratic: 1 × 2² = 4.
  // This site charges quantity × listUnit LINEAR: 2. Same id, different shape.
  assert.equal(line(r, "vital_health_regen_tick").spendTokens, 2, "linear 2, not quadratic 4");
  assert.equal(line(r, "vital_mana_regen_tick").spendTokens, 1);
});

test("DIVERGES site 2 vs site 1: actor affinity NEVER consults the price list — 83 vs 39", async () => {
  const { calculateActorConfigurationUnitCost, priceMap } = await load();
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap });
  // cost-model constants: base 30 + Σ(10+8(n−1)²)=28 + emit expression 25 = 83.
  // Price-list model for the identical payload: base 10 + 1×2² + 25 = 39.
  assert.equal(line(r, "water:emit").spendTokens, 83, "cost-model math, list ignored");
});

test("site 2 (EMPTY price map): silent fallback nearly doubles the card — 236 vs 119", async () => {
  const { calculateActorConfigurationUnitCost } = await load();
  const r = calculateActorConfigurationUnitCost({ entry: CARD, priceMap: new Map() });
  assert.equal(r.cost, 236);
  assert.equal(r.detail.pricingSource, "fallback");
  // VITAL_MAX_COST_MULTIPLIER: health/mana/durability 2, stamina 1.
  assert.equal(line(r, "vital_health_point").spendTokens, 20);
  assert.equal(line(r, "vital_stamina_point").spendTokens, 6);
  // REGEN_COST_COEFFICIENT quadratic: health 12 × 2² = 48, mana 5 × 1² = 5.
  assert.equal(line(r, "vital_health_regen_tick").spendTokens, 48);
  assert.equal(line(r, "vital_mana_regen_tick").spendTokens, 5);
  // DEFAULT_MOTIVATION_COSTS: 25 each (list: 2 and 3) — the pinned overcharge.
  assert.equal(line(r, "motivation_exploring").spendTokens, 25);
  assert.equal(line(r, "motivation_attacking").spendTokens, 25);
});

// ── Site 3: motivation stack costing ──

test("site 3: motivations — 5 with the list, 50 via silent fallback", async () => {
  const { calculateMotivationStackCost, priceMap } = await load();
  assert.equal(calculateMotivationStackCost(CARD.motivations, priceMap).cost, 5);
  assert.equal(calculateMotivationStackCost(CARD.motivations, new Map()).cost, 50);
});

// ── Site 4: budget maximizer — its own regen price model ──

test("DIVERGES site 4 vs site 2: maximizer prices regen from REGEN_COST_COEFFICIENT, never the list", async () => {
  const { maximizeActorBudget, priceList } = await load();
  const blank = () => ({ current: 0, max: 0, regen: 0 });
  const [a] = maximizeActorBudget({
    actors: [{ id: "a1", vitals: { health: blank(), mana: blank(), stamina: blank(), durability: blank() } }],
    remaining: 100,
    priceList,
  });
  // 25-token regen budget split 4 ways ≈ 6 each; coeffs 12/5/4/10 quadratic:
  // health floor(√(6/12))=0, mana floor(√(6/5))=1, stamina 1, durability 0.
  // The receipt path (site 2) would charge those same regens at list-linear 1/tick —
  // the maximizer believes regen is 5–48× more expensive than it will be charged.
  assert.equal(a.vitals.health.regen, 0);
  assert.equal(a.vitals.mana.regen, 1);
  assert.equal(a.vitals.stamina.regen, 1);
  assert.equal(a.vitals.durability.regen, 0);
  // Vital points DO use the list (1/point): 91 points from 75 vital budget + regen leftover.
  const points = ["health", "mana", "stamina", "durability"].reduce((s, k) => s + a.vitals[k].max, 0);
  assert.equal(points, 91);
});

// ── The resource model, and the three-answers problem ──

test("resource model: premium-derived ids for the census resource (water emit 2, mana 50, regen 5)", async () => {
  const { item, applyFormula } = await load();
  const expect = {
    resource_affinity_base: { unitCost: 15, q: 1, total: 15 },
    resource_affinity_stack: { unitCost: 2, q: 2, total: 8 },
    resource_affinity_expression_localized: { unitCost: 38, q: 1, total: 38 },
    resource_vital_mana_point: { unitCost: 2, q: 50, total: 100 },
    resource_vital_mana_regen_tick: { unitCost: 2, q: 5, total: 50 },
  };
  for (const [id, e] of Object.entries(expect)) {
    const it = item(id);
    assert.ok(it, `price list defines ${id}`);
    assert.equal(it.unitCost, e.unitCost, `${id} unitCost`);
    assert.equal(applyFormula(it, e.q), e.total, `${id} total`);
  }
});

test("DIVERGES: 'water, emit, 2 stacks' has THREE different prices today — 83 actor, 39 list, 61 resource", async () => {
  const { calculateActorConfigurationUnitCost, priceMap, item, applyFormula } = await load();
  const actorPrice = line(
    calculateActorConfigurationUnitCost({ entry: { affinities: CARD.affinities }, priceMap }),
    "water:emit",
  ).spendTokens;
  const listPrice =
    applyFormula(item("affinity_base"), 1) +
    applyFormula(item("affinity_stack"), 2) +
    applyFormula(item("affinity_expression_localized"), 1);
  const resourcePrice =
    applyFormula(item("resource_affinity_base"), 1) +
    applyFormula(item("resource_affinity_stack"), 2) +
    applyFormula(item("resource_affinity_expression_localized"), 1);
  assert.equal(actorPrice, 83);
  assert.equal(listPrice, 39);
  assert.equal(resourcePrice, 61);
  // The resource premium is supposed to be 1.5× the base model; the actor model
  // is so far above the list that the "premium" resource is CHEAPER than the actor.
  assert.ok(actorPrice > resourcePrice, "pinned absurdity: free-floating costs less than attached");
});

// ## TODO: Test Permutations
// - site 2 with a price map containing only vitals (partial map): which lines fall back?
// - site 2 affinityCostScale ≠ 1 (room cards): scale applies to base+stack but not expression?
// - site 4 with a priceList whose vital points cost 0: division guard behavior
// - site 3 intensity > 1: unit × intensity for listed and fallback paths
// - expression variants push/pull (external 35) vs emit/draw (internal 25) at both sites
