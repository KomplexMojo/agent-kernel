/**
 * KNOWN BUG, PINNED: the motivation price fallback silently overcharges.
 *
 * These tests assert the CURRENT (wrong) behaviour on purpose, so the bug is
 * visible, measurable, and cannot widen unnoticed. They are not an endorsement.
 * Delete them when the fallback is fixed.
 *
 * The bug
 * -------
 * resolveMotivationUnitCost consults the price list first and, on a miss, falls
 * back to a hardcoded DEFAULT_MOTIVATION_COSTS value. Those two disagree by up to
 * 12x — the price list says `exploring = 2`, the fallback says 25.
 *
 * So a caller holding a price map WITHOUT motivation entries is charged the
 * fallback with no error and no warning. Verified consequence: the budget
 * maximizer path (`ak create ... maximize spend`) charges 25 for `attacking`,
 * which the price list prices at 3 — an ~8x overcharge that silently starves the
 * delver of ~18 tokens of mana.
 *
 * Why it is not fixed here
 * -----------------------
 * Making the miss a hard error is the right contract, but it changes what the
 * maximizer can afford (mana.max 29 -> 47 in
 * tests/adapters-cli/ak-authoring-commands.test.js). The real fix is to give the
 * maximizer a complete price map so `attacking` resolves to 3 from the list, and
 * only then reject incomplete lists. That is a behavioural change to budget
 * allocation and needs its own milestone plus a benchmark re-baseline.
 *
 * See allocator/README.md, "Known divergence".
 */
const assert = require("node:assert/strict");

const POLICY = "../../packages/runtime/src/personas/allocator/motivation-price-policy.js";
const PRICES = "../../packages/runtime/src/personas/allocator/default-price-list.js";

function priceMapFrom(items) {
  return new Map(items.map((i) => [`${i.kind}:${i.id}`, i.unitCost]));
}

async function fullPriceMap() {
  const { buildDefaultPriceList } = await import(PRICES);
  return priceMapFrom(buildDefaultPriceList().items);
}

test("every motivation kind now has a price list entry (motivation_user_controlled was missing)", async () => {
  const { MOTIVATION_PRICE_IDS } = await import(POLICY);
  const { buildDefaultPriceList } = await import(PRICES);
  const ids = new Set(buildDefaultPriceList().items.map((i) => i.id));
  for (const [kind, id] of Object.entries(MOTIVATION_PRICE_IDS)) {
    assert.ok(ids.has(id), `${kind} maps to ${id}, which the price list does not define`);
  }
});

test("user_controlled resolves to the same 10 from the list as it used to from the fallback", async () => {
  const { resolveMotivationUnitCost, DEFAULT_MOTIVATION_COSTS } = await import(POLICY);
  const map = await fullPriceMap();
  // Adding it to base-costs.json preserved behaviour exactly — it was 10 either way.
  assert.equal(resolveMotivationUnitCost("user_controlled", map), 10);
  assert.equal(DEFAULT_MOTIVATION_COSTS.user_controlled, 10);
});

test("with a COMPLETE price list, the list wins — this is the correct path", async () => {
  const { resolveMotivationUnitCost } = await import(POLICY);
  const map = await fullPriceMap();
  assert.equal(resolveMotivationUnitCost("exploring", map), 2);
  assert.equal(resolveMotivationUnitCost("attacking", map), 3);
  assert.equal(resolveMotivationUnitCost("strategy_focused", map), 10);
});

test("BUG: an INCOMPLETE price list silently falls back instead of failing", async () => {
  const { resolveMotivationUnitCost } = await import(POLICY);
  const map = await fullPriceMap();
  map.delete("motivation:motivation_exploring");

  const charged = resolveMotivationUnitCost("exploring", map);
  // Correct behaviour would be an error. Instead it quietly charges 25 — 12x the
  // list price of 2 — and nothing anywhere reports it.
  assert.equal(charged, 25, "pinning the bug: silent fallback, not an error");
});

test("BUG: quantifies the fallback gap per motivation kind", async () => {
  const { resolveMotivationUnitCost, MOTIVATION_PRICE_IDS, DEFAULT_MOTIVATION_COSTS } = await import(POLICY);
  const map = await fullPriceMap();
  const gaps = [];
  for (const kind of Object.keys(MOTIVATION_PRICE_IDS)) {
    const listed = resolveMotivationUnitCost(kind, map);
    const fallback = DEFAULT_MOTIVATION_COSTS[kind];
    if (listed !== fallback) gaps.push({ kind, listed, fallback });
  }
  // Every kind except user_controlled disagrees — the fallback is not a safety
  // net, it is a different pricing model wearing one as a disguise.
  assert.ok(gaps.length >= 10, `expected widespread divergence, found ${gaps.length}`);
  const attacking = gaps.find((g) => g.kind === "attacking");
  assert.deepEqual(attacking, { kind: "attacking", listed: 3, fallback: 25 });
});

test("calculateMotivationStackCost has no errors channel — misses cannot be reported", async () => {
  const { calculateMotivationStackCost } = await import(POLICY);
  const result = calculateMotivationStackCost([{ kind: "exploring", intensity: 1 }], await fullPriceMap());
  assert.equal(result.errors, undefined, "pinning: no way to surface an incomplete price list");
});
