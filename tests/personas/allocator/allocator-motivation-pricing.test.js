/**
 * Motivation price policy under the unified model (P1.4).
 *
 * Replaces tests/personas/allocator-motivation-price-policy.test.js and
 * tests/financial-model/motivation-pricing.test.js, which tested the deleted
 * 25/50/10 tier-fallback economy. The price list is the only pricing source;
 * resolution without a usable entry is null/errors, never a default.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/allocator/";

async function load() {
  const policy = await import(`${P}motivation-price-policy.js`);
  const { buildDefaultPriceList } = await import(`${P}default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}validate-spend.js`);
  return { ...policy, priceMap: normalizePriceItems(buildDefaultPriceList()) };
}

test("families and price ids cover all 12 kinds; family resolution intact", async () => {
  const { MOTIVATION_PRICE_IDS, resolveMotivationFamily } = await load();
  // MOTIVATION_FAMILIES comes from contracts/domain-constants.js (P5.1 D2). The
  // Allocator used to hand-maintain its own byte-identical copy; the G2 single-origin
  // guard found it. Reading the canonical value here is the point of the test — it
  // proves the Allocator's price ids cover the real vocabulary, not its own copy of it.
  const { MOTIVATION_FAMILIES } = await import(
    "../../../packages/runtime/src/contracts/domain-constants.js"
  );
  const allKinds = [
    ...MOTIVATION_FAMILIES.mobility,
    ...MOTIVATION_FAMILIES.posture,
    ...MOTIVATION_FAMILIES.cognition,
    ...MOTIVATION_FAMILIES.control,
  ];
  assert.equal(allKinds.length, 12);
  for (const kind of allKinds) {
    assert.ok(MOTIVATION_PRICE_IDS[kind], `${kind} has a price id`);
  }
  assert.equal(resolveMotivationFamily("random"), "mobility");
  assert.equal(resolveMotivationFamily("attacking"), "posture");
  assert.equal(resolveMotivationFamily("reflexive"), "cognition");
  assert.equal(resolveMotivationFamily("user_controlled"), "control");
  assert.equal(resolveMotivationFamily("unknown"), null);
});

test("every kind resolves from the LIST; cognition prices still order upward", async () => {
  const { resolveMotivationUnitCost, MOTIVATION_PRICE_IDS, priceMap } = await load();
  for (const kind of Object.keys(MOTIVATION_PRICE_IDS)) {
    const unit = resolveMotivationUnitCost(kind, priceMap);
    assert.ok(Number.isFinite(unit) && unit >= 0, `${kind} priced from the list`);
  }
  // The old tier ORDERING survives in list values (1 ≤ 5 ≤ 10), the old
  // NUMBERS (25/50) do not.
  const cost = (k) => resolveMotivationUnitCost(k, priceMap);
  assert.ok(cost("reflexive") <= cost("goal_oriented"));
  assert.ok(cost("goal_oriented") <= cost("strategy_focused"));
  assert.equal(cost("exploring"), 2);
  assert.equal(cost("attacking"), 3);
  assert.equal(cost("user_controlled"), 10);
});

test("no price map, no price: resolution is null, stack cost errors — never a default", async () => {
  const { resolveMotivationUnitCost, calculateMotivationStackCost } = await load();
  assert.equal(resolveMotivationUnitCost("reflexive"), null);
  assert.equal(resolveMotivationUnitCost("unknown_kind", new Map()), null);
  const r = calculateMotivationStackCost([{ kind: "reflexive" }]);
  assert.equal(r.cost, 0);
  assert.equal(r.lineItems.length, 0);
  assert.ok(r.errors.some((e) => /reflexive/.test(e)));
});

test("stack cost: line items, intensity scaling, overrides, determinism", async () => {
  const { calculateMotivationStackCost, priceMap } = await load();

  const single = calculateMotivationStackCost([{ kind: "reflexive", intensity: 1 }], priceMap);
  assert.equal(single.cost, 1);
  assert.deepEqual(
    { id: single.lineItems[0].id, family: single.lineItems[0].family, spend: single.lineItems[0].spendTokens },
    { id: "motivation_reflexive", family: "cognition", spend: 1 },
  );

  // random(1) + attacking(3) + goal_oriented(5) = 9
  const mixed = calculateMotivationStackCost(
    [{ kind: "random" }, { kind: "attacking" }, { kind: "goal_oriented" }],
    priceMap,
  );
  assert.equal(mixed.cost, 9);
  assert.equal(mixed.lineItems.length, 3);

  const scaled = calculateMotivationStackCost([{ kind: "goal_oriented", intensity: 3 }], priceMap);
  assert.equal(scaled.cost, 15);
  assert.equal(scaled.lineItems[0].quantity, 3);

  const overrides = new Map(priceMap);
  overrides.set("motivation:motivation_random", 99);
  assert.equal(calculateMotivationStackCost([{ kind: "random" }], overrides).cost, 99);

  assert.equal(calculateMotivationStackCost(null).cost, 0);
  assert.equal(calculateMotivationStackCost(undefined).cost, 0);

  const motivations = [
    { kind: "patrolling", intensity: 2 },
    { kind: "stealthy", intensity: 1 },
    { kind: "strategy_focused", intensity: 1 },
  ];
  const r1 = calculateMotivationStackCost(motivations, priceMap);
  const r2 = calculateMotivationStackCost(motivations, priceMap);
  assert.deepEqual(r1, r2, "deterministic");
  // patrolling 3×2 + stealthy 4 + strategy_focused 10 = 20
  assert.equal(r1.cost, 20);
});

// ## TODO: Test Permutations
// - number-map vs item-map resolution parity for every kind
// - intensity 0 / negative / non-integer normalization to 1
// - overrides map with an entry priced 0 (stationary) — priced, no error
// - mixed priced/unpriced stack: cost sums priced kinds, errors name the rest
