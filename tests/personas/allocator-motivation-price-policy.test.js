const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const policyModule = moduleUrl("packages/runtime/src/personas/allocator/motivation-price-policy.js");

const script = `
import assert from "node:assert/strict";
import {
  DEFAULT_MOTIVATION_COSTS,
  MOTIVATION_FAMILIES,
  MOTIVATION_PRICE_IDS,
  resolveMotivationUnitCost,
  resolveMotivationFamily,
  calculateMotivationStackCost,
  buildMotivationPriceListItems,
} from ${JSON.stringify(policyModule)};

// ── DEFAULT_MOTIVATION_COSTS: simple=25, advanced=50 (design §6.6) ──
assert.ok(
  DEFAULT_MOTIVATION_COSTS.reflexive <= DEFAULT_MOTIVATION_COSTS.goal_oriented,
  "reflexive should not be more expensive than goal_oriented"
);
assert.ok(
  DEFAULT_MOTIVATION_COSTS.goal_oriented <= DEFAULT_MOTIVATION_COSTS.strategy_focused,
  "goal_oriented should not be more expensive than strategy_focused"
);

// ── Every motivation kind has a price ID ──
const allKinds = [
  ...MOTIVATION_FAMILIES.mobility,
  ...MOTIVATION_FAMILIES.posture,
  ...MOTIVATION_FAMILIES.cognition,
  ...MOTIVATION_FAMILIES.control,
];
allKinds.forEach((kind) => {
  assert.ok(MOTIVATION_PRICE_IDS[kind], kind + " should have a price ID");
  assert.ok(kind in DEFAULT_MOTIVATION_COSTS, kind + " should have a default cost");
});

// ── resolveMotivationUnitCost falls back to defaults (design §6.6) ──
assert.equal(resolveMotivationUnitCost("reflexive"), 25);    // simple
assert.equal(resolveMotivationUnitCost("goal_oriented"), 50); // advanced
assert.equal(resolveMotivationUnitCost("strategy_focused"), 50); // advanced
assert.equal(resolveMotivationUnitCost("random"), 25);        // simple
assert.equal(resolveMotivationUnitCost("stationary"), 25);     // simple
assert.equal(resolveMotivationUnitCost("user_controlled"), 10);
assert.equal(resolveMotivationUnitCost("unknown_kind"), 0);

// ── resolveMotivationUnitCost respects priceMap overrides ──
const priceMap = new Map();
priceMap.set("motivation:motivation_reflexive", 99);
assert.equal(resolveMotivationUnitCost("reflexive", priceMap), 99);
assert.equal(resolveMotivationUnitCost("goal_oriented", priceMap), 50); // still default (advanced)

// ── resolveMotivationFamily ──
assert.equal(resolveMotivationFamily("random"), "mobility");
assert.equal(resolveMotivationFamily("attacking"), "posture");
assert.equal(resolveMotivationFamily("reflexive"), "cognition");
assert.equal(resolveMotivationFamily("user_controlled"), "control");
assert.equal(resolveMotivationFamily("unknown"), null);

// ── calculateMotivationStackCost: empty input ──
{
  const result = calculateMotivationStackCost([]);
  assert.equal(result.cost, 0);
  assert.equal(result.lineItems.length, 0);
}

// ── calculateMotivationStackCost: single motivation ──
{
  const result = calculateMotivationStackCost([{ kind: "reflexive", intensity: 1 }]);
  assert.equal(result.cost, 25); // simple motivation = 25
  assert.equal(result.lineItems.length, 1);
  assert.equal(result.lineItems[0].id, "motivation_reflexive");
  assert.equal(result.lineItems[0].family, "cognition");
  assert.equal(result.lineItems[0].unitCostTokens, 25);
  assert.equal(result.lineItems[0].spendTokens, 25);
}

{
  const result = calculateMotivationStackCost([{ kind: "user_controlled", intensity: 1 }]);
  assert.equal(result.cost, 10);
  assert.equal(result.lineItems[0].id, "motivation_user_controlled");
}

// ── calculateMotivationStackCost: additive multi-family stack ──
{
  // random(25) + attacking(25) + goal_oriented(50) = 100
  const motivations = [
    { kind: "random", intensity: 1 },
    { kind: "attacking", intensity: 1 },
    { kind: "goal_oriented", intensity: 1 },
  ];
  const result = calculateMotivationStackCost(motivations);
  assert.equal(result.cost, 100);
  assert.equal(result.lineItems.length, 3);
}

// ── calculateMotivationStackCost: intensity scales cost ──
{
  const result = calculateMotivationStackCost([{ kind: "goal_oriented", intensity: 3 }]);
  assert.equal(result.cost, 150); // 50 * 3
  assert.equal(result.lineItems[0].quantity, 3);
}

// ── calculateMotivationStackCost: respects priceMap ──
{
  const pm = new Map();
  pm.set("motivation:motivation_random", 10);
  const result = calculateMotivationStackCost([{ kind: "random", intensity: 1 }], pm);
  assert.equal(result.cost, 10);
}

// ── calculateMotivationStackCost: handles null/undefined gracefully ──
{
  assert.equal(calculateMotivationStackCost(null).cost, 0);
  assert.equal(calculateMotivationStackCost(undefined).cost, 0);
}

// ── buildMotivationPriceListItems ──
{
  const items = buildMotivationPriceListItems();
  assert.ok(items.length >= 12, "should include all motivation kinds");
  const reflexiveItem = items.find((item) => item.id === "motivation_reflexive");
  assert.ok(reflexiveItem, "should have reflexive item");
  assert.equal(reflexiveItem.kind, "motivation");
  assert.equal(reflexiveItem.costTokens, 25);
}

// ── deterministic: same inputs always produce same output ──
{
  const motivations = [
    { kind: "patrolling", intensity: 2 },
    { kind: "stealthy", intensity: 1 },
    { kind: "strategy_focused", intensity: 1 },
  ];
  const r1 = calculateMotivationStackCost(motivations);
  const r2 = calculateMotivationStackCost(motivations);
  assert.deepEqual(r1, r2, "results should be deterministic");
  // patrolling(25*2) + stealthy(50*1) + strategy_focused(50*1) = 50 + 50 + 50 = 150
  assert.equal(r1.cost, 150);
}
`;

test("motivation price policy: canonical costs, families, and stack pricing", () => {
  runEsm(script);
});
