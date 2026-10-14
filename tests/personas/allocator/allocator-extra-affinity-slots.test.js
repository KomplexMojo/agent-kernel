// Slots authored beyond an actor's preset are charged at the slot-unlock price, on the
// receipt path and the card path alike; slots at or below the preset cost nothing.
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
  assert.equal(extra.cost - base.cost, 3 * slotPrice);
  assert.deepEqual(extra.detail.lineItems.find((line) => line.category === "affinity_slot"),
    { category: "affinity_slot", id: "resource_affinity_slot", label: "3 extra affinity slots", quantity: 3,
      unitCostTokens: slotPrice, spendTokens: 3 * slotPrice });
});

// ## TODO: Test Permutations
// - slots 1..6 for every preset role
// - a price list without resource_affinity_slot reports an error on the card path
