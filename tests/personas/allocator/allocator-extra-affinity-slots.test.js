// Slots authored beyond an actor's preset are charged at the slot-unlock price, on the
// receipt path and the card path alike; slots at or below the preset cost nothing. The
// price is triangular (maintainer, 2026-10-14): the nth extra slot costs n × the unit.
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/";
const META = Object.freeze({ id: "slots", runId: "slots_run", createdAt: "2026-10-14T00:00:00.000Z", producedBy: "allocator" });

async function load() {
  const { buildSpendProposal, calculateActorConfigurationUnitCost } = await import(`${P}allocator/spend-proposal.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}allocator/validate-spend.js`);
  const { createConfiguratorPersona } = await import(`${P}configurator/persona.js`);
  const normalizeMotivations = createConfiguratorPersona({ clock: () => META.createdAt }).normalizeMotivations;
  const priceList = buildDefaultPriceList();
  return {
    slotPrice: priceList.items.find((item) => item.id === "resource_affinity_slot").unitCost,
    slotLines: (actors) => buildSpendProposal({ meta: META, normalizeMotivations, actors }).items
      .filter((item) => item.id === "resource_affinity_slot"),
    cardCost: (entry) => calculateActorConfigurationUnitCost({ entry, priceMap: normalizePriceItems(priceList), normalizeMotivations }),
  };
}

test("a delver with 5 slots pays for the 2 above its preset of 3; a warden with 3 for 1 above 2", async () => {
  const { slotLines } = await load();
  const lines = slotLines([
    { id: "d", category: "delver", affinitySlots: 5 },
    { id: "w", category: "warden", affinitySlots: 3 },
  ]);
  assert.deepEqual(lines.map((line) => [line.subjectRef.id, line.quantity]).sort(), [["d", 2], ["w", 1]]);
});

test("preset or fewer slots add no slot charge", async () => {
  const { slotLines } = await load();
  assert.deepEqual(slotLines([
    { id: "d", category: "delver", affinitySlots: 3 },
    { id: "w", category: "warden", affinitySlots: 1 },
    { id: "x", category: "delver" },
  ]), []);
});

test("the card path charges the same extra slots at the same price", async () => {
  const { cardCost, slotPrice } = await load();
  const base = cardCost({ type: "delver" });
  const extra = cardCost({ type: "delver", affinitySlots: 6 });
  assert.equal(extra.errors, undefined);
  assert.equal(extra.cost - base.cost, 6 * slotPrice); // 1 + 2 + 3
  assert.deepEqual(extra.detail.lineItems.find((line) => line.category === "affinity_slot"),
    { category: "affinity_slot", id: "resource_affinity_slot", label: "3 extra affinity slots", quantity: 3,
      unitCostTokens: slotPrice, spendTokens: 6 * slotPrice });
});

test("slot pricing is triangular: 1, 3, 6 units for 1, 2, 3 slots, for loot and authored slots alike", async () => {
  const { buildDefaultPriceList, applyFormula } = await import(`${P}allocator/default-price-list.js`);
  const { calculatePriceTotal } = await import(`${P}allocator/validate-spend.js`);
  const item = buildDefaultPriceList().items.find((entry) => entry.id === "resource_affinity_slot");
  assert.equal(item.formula, "triangular");
  assert.deepEqual([1, 2, 3].map((n) => calculatePriceTotal(item, n)), [1, 3, 6].map((k) => k * item.unitCost));
  assert.deepEqual([1, 2, 3].map((n) => applyFormula(item, n)), [1, 3, 6].map((k) => k * item.unitCost));
});

// ## TODO: Test Permutations
// - slots 1..6 for every preset role
// - a price list without resource_affinity_slot reports an error on the card path
