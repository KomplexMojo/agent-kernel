const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const motivationUrl = moduleUrl("packages/runtime/src/personas/allocator/motivation-price-policy.js");

test("simple motivations cost 25, advanced cost 50 (design §6.6)", () => {
  runEsm(`
import assert from "node:assert/strict";
import {
  DEFAULT_MOTIVATION_COSTS,
  SIMPLE_MOTIVATION_COST,
  ADVANCED_MOTIVATION_COST,
  MOTIVATION_TIER,
} from ${JSON.stringify(motivationUrl)};

assert.equal(SIMPLE_MOTIVATION_COST, 25);
assert.equal(ADVANCED_MOTIVATION_COST, 50);

// Verify each motivation's cost matches its tier
for (const [kind, tier] of Object.entries(MOTIVATION_TIER)) {
  const expectedCost = tier === "advanced" ? 50 : 25;
  assert.equal(
    DEFAULT_MOTIVATION_COSTS[kind],
    expectedCost,
    kind + " should cost " + expectedCost,
  );
}
`);
});

test("calculateMotivationStackCost uses updated pricing", () => {
  runEsm(`
import assert from "node:assert/strict";
import { calculateMotivationStackCost } from ${JSON.stringify(motivationUrl)};

// Simple motivation: 25 tokens
const simple = calculateMotivationStackCost([{ kind: "defending" }]);
assert.equal(simple.cost, 25);

// Advanced motivation: 50 tokens
const advanced = calculateMotivationStackCost([{ kind: "strategy_focused" }]);
assert.equal(advanced.cost, 50);

// Mixed: simple + advanced = 75
const mixed = calculateMotivationStackCost([
  { kind: "attacking" },
  { kind: "goal_oriented" },
]);
assert.equal(mixed.cost, 75);
`);
});
