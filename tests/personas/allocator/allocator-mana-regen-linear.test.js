/**
 * #834 (Darren, 2026-11-10): mana regen is priced linearly, 3 tokens a point. It was n² like the
 * other regens, so the regen to cast intensity i every turn (2i² mana) cost 4i⁴ tokens and high
 * intensity was never worth its slot: an intensity-2 push on a wall of health beat every other
 * build. Health, stamina and durability regen stay quadratic.
 */
const assert = require("node:assert/strict");
const { configuratorNormalizeMotivations } = require("../../helpers/configurator-capabilities.js");

const P = "../../../packages/runtime/src/personas/";
const card = (manaRegen, healthRegen = 0) => ({
  vitals: { health: { max: 10, regen: healthRegen }, mana: { max: 10, regen: manaRegen }, stamina: { max: 5 }, durability: { max: 5 } },
  affinities: [], motivations: [{ kind: "attacking" }],
});

async function lines(entry) {
  const { createAllocatorPersona } = await import(`${P}allocator/controller.js`);
  const { calculateActorConfigurationUnitCost } = await import(`${P}allocator/spend-proposal.js`);
  const normalizeMotivations = await configuratorNormalizeMotivations();
  const priceMap = createAllocatorPersona({ clock: () => "2026-11-10T00:00:00.000Z" }).pricing.priceMap();
  const result = calculateActorConfigurationUnitCost({ entry, priceMap, normalizeMotivations });
  assert.equal(result.errors, undefined);
  return (id) => result.detail.lineItems.find((line) => line.id === id)?.spendTokens ?? 0;
}

test("mana regen costs 3 tokens a point, however much is bought", async () => {
  for (const regen of [1, 2, 8, 18, 32]) {
    assert.equal((await lines(card(regen)))("vital_mana_regen_tick"), 3 * regen, `regen ${regen}`);
  }
});

test("the other regens are still quadratic", async () => {
  assert.equal((await lines(card(1, 4)))("vital_health_regen_tick"), 16);
});

test("the price list states it: mana regen linear at 3, and a resource's mirrors the shape", async () => {
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const items = Object.fromEntries(buildDefaultPriceList().items.map((item) => [item.id, item]));
  assert.equal(items.vital_mana_regen_tick.unitCost, 3);
  assert.equal(items.vital_mana_regen_tick.formula, "linear");
  assert.equal(items.resource_vital_mana_regen_tick.formula, "linear");
  assert.equal(items.vital_health_regen_tick.formula, "quadratic");
});

// ## TODO: Test Permutations
// - a delver recipe with mana regen 18 prices its regen at 54
// - the budget maximizer buys mana regen at 3 a point from a regen allotment
// - a level-permanence resource granting mana regen multiplies the linear price by its mode
