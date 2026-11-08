/**
 * #675 (Darren, 2026-11-02): temperament is a priced stat, never a silent extra. The Allocator
 * lists `actor_temperament` and charges n² × its unit, the same at the receipt and at the
 * per-actor price.
 */
const assert = require("node:assert/strict");
const { configuratorNormalizeMotivations } = require("../../helpers/configurator-capabilities.js");

const P = "../../../packages/runtime/src/personas/allocator/";
const META = { id: "t", runId: "t", createdAt: "2026-11-08T00:00:00.000Z", producedBy: "allocator" };
const ACTOR = { id: "rover", type: "delver", vitals: { health: { max: 10, regen: 1 } }, motivations: [{ kind: "strategy_focused" }] };

async function load() {
  const { buildDefaultPriceList } = await import(`${P}default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}validate-spend.js`);
  const { buildSpendProposal, calculateActorConfigurationUnitCost } = await import(`${P}spend-proposal.js`);
  const normalizeMotivations = await configuratorNormalizeMotivations();
  const priceList = buildDefaultPriceList();
  const priceMap = normalizePriceItems(priceList);
  return {
    item: priceList.items.find((entry) => entry.id === "actor_temperament"),
    unitCost: (actor) => calculateActorConfigurationUnitCost({ entry: actor, priceMap, normalizeMotivations }).cost,
    charged: (actor) => buildSpendProposal({ meta: META, normalizeMotivations, actors: [actor] }).items
      .filter((entry) => entry.id === "actor_temperament"),
  };
}

test("temperament is listed, quadratic, at 5 tokens a unit", async () => {
  const { item } = await load();
  assert.deepEqual({ kind: item.kind, unitCost: item.unitCost, formula: item.formula }, { kind: "actor", unitCost: 5, formula: "quadratic" });
});

test("an actor pays n² × 5 for temperament n, and nothing at 0", async () => {
  const { unitCost } = await load();
  const calm = unitCost(ACTOR);
  assert.equal(unitCost({ ...ACTOR, temperament: 0 }), calm);
  assert.equal(unitCost({ ...ACTOR, temperament: 1 }) - calm, 5);
  assert.equal(unitCost({ ...ACTOR, temperament: 3 }) - calm, 45);
});

test("the receipt carries the same line the per-actor price charges", async () => {
  const { charged } = await load();
  assert.deepEqual(charged(ACTOR), []);
  const [line] = charged({ ...ACTOR, temperament: 3 });
  assert.equal(line.quantity, 3);
  assert.equal(line.subjectRef.id, "rover");
});

// ## TODO: Test Permutations
// - two bold actors pay each their own square, never the square of the sum
// - a negative or fractional temperament prices as 0 (the Configurator refuses it before the run)
