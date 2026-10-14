/**
 * The playable premium (Darren, 2026-10-13): `user_controlled` costs the most expensive
 * autonomous motivation stack plus one, worked out from the price list in force, so the
 * right to play an actor is always the dearest motivation whatever the other prices are.
 * An autonomous stack is one motivation per family (mobility, posture, cognition).
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/allocator/";

async function load() {
  const policy = await import(`${P}motivation-price-policy.js`);
  const { buildDefaultPriceList } = await import(`${P}default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}validate-spend.js`);
  const { MOTIVATION_FAMILIES } = await import("../../../packages/runtime/src/contracts/domain-constants.js");
  const baseCosts = (await import(`${P}base-costs.json`, { with: { type: "json" } })).default;
  return { ...policy, buildDefaultPriceList, normalizePriceItems, MOTIVATION_FAMILIES, baseCosts };
}

function autonomousStacks(families) {
  const stacks = [[]];
  for (const family of ["mobility", "posture", "cognition"]) {
    const next = [];
    for (const stack of stacks) {
      next.push(stack);
      for (const kind of families[family]) next.push([...stack, kind]);
    }
    stacks.splice(0, stacks.length, ...next);
  }
  return stacks;
}

test("the default price list prices user_controlled at the dearest autonomous stack plus one", async () => {
  const { buildDefaultPriceList, normalizePriceItems, resolveMotivationUnitCost, MOTIVATION_FAMILIES } = await load();
  const priceMap = normalizePriceItems(buildDefaultPriceList());
  const cost = (kind) => resolveMotivationUnitCost(kind, priceMap);
  const dearest = ["mobility", "posture", "cognition"]
    .map((family) => Math.max(...MOTIVATION_FAMILIES[family].map(cost)))
    .reduce((sum, price) => sum + price, 0);
  assert.equal(cost("user_controlled"), dearest + 1);

  const listed = buildDefaultPriceList().items.find((item) => item.id === "motivation_user_controlled");
  assert.ok(listed, "the default price list still lists user_controlled");
  assert.equal(listed.unitCost, dearest + 1, "the listed price is the formula's, not a typed-in number");
});

test("user_controlled costs more than every autonomous stack", async () => {
  const { buildDefaultPriceList, normalizePriceItems, calculateMotivationStackCost, MOTIVATION_FAMILIES } = await load();
  const priceMap = normalizePriceItems(buildDefaultPriceList());
  const playable = calculateMotivationStackCost([{ kind: "user_controlled" }], priceMap).cost;
  for (const stack of autonomousStacks(MOTIVATION_FAMILIES)) {
    const { cost } = calculateMotivationStackCost(stack.map((kind) => ({ kind })), priceMap);
    assert.ok(playable > cost, `user_controlled (${playable}) > ${stack.join("+") || "nothing"} (${cost})`);
  }
});

test("the premium follows the price list in force, not a listed user_controlled price", async () => {
  const { buildDefaultPriceList, normalizePriceItems, resolveMotivationUnitCost } = await load();
  const list = buildDefaultPriceList();
  const items = list.items.map((item) => {
    if (item.id === "motivation_strategy_focused") return { ...item, unitCost: 30 };
    if (item.id === "motivation_user_controlled") return { ...item, unitCost: 2 };
    return item;
  });
  const priceMap = normalizePriceItems({ ...list, items });
  const cost = (kind) => resolveMotivationUnitCost(kind, priceMap);
  assert.equal(cost("user_controlled"), cost("patrolling") + cost("stealthy") + 30 + 1);
});

test("a price list missing a family's prices cannot price user_controlled", async () => {
  const { buildDefaultPriceList, normalizePriceItems, resolveMotivationUnitCost, MOTIVATION_FAMILIES } = await load();
  const list = buildDefaultPriceList();
  const cognitionIds = new Set(MOTIVATION_FAMILIES.cognition.map((kind) => `motivation_${kind}`));
  const priceMap = normalizePriceItems({ ...list, items: list.items.filter((item) => !cognitionIds.has(item.id)) });
  assert.equal(resolveMotivationUnitCost("user_controlled", priceMap), null);
});

test("base-costs.json carries no typed-in user_controlled price", async () => {
  const { baseCosts } = await load();
  assert.equal(Object.hasOwn(baseCosts.motivation, "motivation_user_controlled"), false);
});

// ## TODO: Test Permutations
// - a stack of intensity > 1 autonomous motivations still costs less than user_controlled at intensity 1.
// - raising any single autonomous price by n raises user_controlled by n only when it becomes its family's dearest.
// - user_controlled listed with no autonomous prices at all resolves to null and the stack cost reports an error.
