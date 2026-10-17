// #281: every card price in the card builder is the Allocator's. Hazard cards were priced at
// their caller-set tokenHint alone, resource cards by glue arithmetic (or their budgetCeiling),
// and a card with no price list read an empty price map. Now each card is priced from the same spend
// items the build's receipt charges, against the default price list when none is given.
const assert = require("node:assert/strict");

async function load() {
  const authoring = await import("../../../packages/runtime/src/commands/card-authoring.js");
  const { buildDefaultPriceList } = await import("../../../packages/runtime/src/personas/allocator/persona.js");
  return { ...authoring, priceList: buildDefaultPriceList({ createdAt: "2026-10-17T00:00:00.000Z" }) };
}

const HAZARD = {
  id: "hazard_card", type: "hazard", affinity: "fire", expressions: ["emit"],
  mana: { kind: "regen", current: 3, max: 3, regen: 1 }, durability: { kind: "regen", current: 5, max: 5, regen: 0 },
};
const RESOURCE = {
  id: "resource_card", type: "resource", affinity: "growth", resourceVitals: { mana: { delta: 4, regen: 2 } },
};

test("a hazard card is priced by the Allocator, not by its tokenHint", async () => {
  const { createDesignCard, calculateCardValue, priceList } = await load();
  const plain = calculateCardValue(createDesignCard(HAZARD), { priceList });
  const hinted = calculateCardValue(createDesignCard({ ...HAZARD, tokenHint: 75 }), { priceList });
  assert.ok(plain.unitTokens > 0, "a hazard costs something without a tokenHint");
  assert.equal(hinted.unitTokens, plain.unitTokens + 75, "a tokenHint is extra spend on top of the price, not the price");
  const ids = plain.lineItems.map((item) => item.id);
  assert.ok(ids.includes("hazard_basic"), ids.join(","));
  assert.ok(ids.includes("affinity_base"), ids.join(","));
});

test("a resource card is priced by the Allocator, not by its budgetCeiling", async () => {
  const { createDesignCard, calculateCardValue, priceList } = await load();
  const plain = calculateCardValue(createDesignCard(RESOURCE), { priceList });
  const capped = calculateCardValue(createDesignCard({ ...RESOURCE, budgetCeiling: 100 }), { priceList });
  assert.ok(plain.unitTokens > 0);
  assert.equal(capped.unitTokens, plain.unitTokens, "budgetCeiling is not a price");
  const permanent = calculateCardValue(createDesignCard({ ...RESOURCE, permanent: true }), { priceList });
  assert.ok(permanent.unitTokens > plain.unitTokens, "a permanent grant costs more than a consumable one");
});

test("a card with no price list is priced at the Allocator's default prices", async () => {
  const { createDesignCard, calculateCardValue, priceList } = await load();
  for (const card of [HAZARD, RESOURCE,
    { id: "delver_card", type: "delver", affinity: "fire", motivations: ["exploring"] },
    { id: "room_card", type: "room", affinity: "fire", roomSize: "small" }]) {
    const designed = createDesignCard(card);
    assert.equal(calculateCardValue(designed).unitTokens, calculateCardValue(designed, { priceList }).unitTokens, card.type);
  }
});

// ## TODO: Test Permutations
// - a hazard card with several stacks costs more than a one-stack hazard of the same affinity.
// - a resource card granting an affinity slot is charged resource_affinity_slot.
// - enrichCardsWithBudget totals match the sum of calculateCardValue totals.
