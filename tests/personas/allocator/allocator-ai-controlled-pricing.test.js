/** `ai_controlled` is priced as the playable premium: the dearest autonomous stack + 1. */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/allocator/";

test("ai_controlled costs the same derived premium as user_controlled, from the list in force", async () => {
  const policy = await import(`${P}motivation-price-policy.js`);
  const { buildDefaultPriceList } = await import(`${P}default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}validate-spend.js`);
  const priceMap = normalizePriceItems(buildDefaultPriceList());
  const ai = policy.resolveMotivationUnitCost("ai_controlled", priceMap);
  assert.equal(ai, policy.resolveMotivationUnitCost("user_controlled", priceMap));
  assert.equal(ai, 18);
  assert.equal(policy.resolveMotivationFamily("ai_controlled"), "control");
  assert.equal(policy.resolveMotivationUnitCost("ai_controlled", null), null);
});
