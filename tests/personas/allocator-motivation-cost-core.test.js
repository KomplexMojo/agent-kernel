const assert = require("node:assert/strict");


test("motivation cost delegation: core-ts matches JS for all kinds and intensities", async () => {
const { createCore } = await import("../../packages/core-ts/src/index.ts");
const {
  calculateMotivationStackCost,
  calculateMotivationStackCostFromCore,
  MOTIVATION_KIND_TO_CODE,
  DEFAULT_MOTIVATION_COSTS,
} = await import("../../packages/runtime/src/personas/allocator/motivation-price-policy.js");

const core = createCore();
core.init(0);

// ── MOTIVATION_KIND_TO_CODE covers all 12 kinds ──

assert.equal(Object.keys(MOTIVATION_KIND_TO_CODE).length, 12, "12 kind codes");
assert.equal(MOTIVATION_KIND_TO_CODE.random, 1);
assert.equal(MOTIVATION_KIND_TO_CODE.attacking, 5);
assert.equal(MOTIVATION_KIND_TO_CODE.user_controlled, 12);

// ── Single motivation: core-ts matches JS ──

{
  const motivations = [{ kind: "reflexive", intensity: 1 }];
  const jsResult = calculateMotivationStackCost(motivations);
  const coreResult = calculateMotivationStackCostFromCore(core, motivations);
  assert.equal(coreResult.cost, jsResult.cost, "reflexive: core-ts cost == JS cost");
  assert.equal(coreResult.cost, 25, "reflexive = 25 tokens");
  assert.equal(coreResult.lineItems.length, 1, "one line item");
  assert.equal(coreResult.lineItems[0].motivationKind, "reflexive");
  assert.equal(coreResult.lineItems[0].category, "motivation");
  assert.equal(coreResult.lineItems[0].quantity, 1);
  assert.equal(coreResult.lineItems[0].unitCostTokens, 25);
  assert.equal(coreResult.lineItems[0].spendTokens, 25);
}

// ── Multiple motivations: additive ──

{
  const motivations = [
    { kind: "random", intensity: 1 },
    { kind: "attacking", intensity: 1 },
    { kind: "goal_oriented", intensity: 1 },
  ];
  const jsResult = calculateMotivationStackCost(motivations);
  const coreResult = calculateMotivationStackCostFromCore(core, motivations);
  // random(25) + attacking(25) + goal_oriented(50) = 100
  assert.equal(coreResult.cost, 100, "multi-motivation total = 100");
  assert.equal(coreResult.cost, jsResult.cost, "core-ts == JS for multi-motivation");
  assert.equal(coreResult.lineItems.length, 3, "three line items");
}

// ── Intensity multiplier ──

{
  const motivations = [{ kind: "strategy_focused", intensity: 2 }];
  const jsResult = calculateMotivationStackCost(motivations);
  const coreResult = calculateMotivationStackCostFromCore(core, motivations);
  // strategy_focused(50) * intensity(2) = 100
  assert.equal(coreResult.cost, 100, "intensity multiplier");
  assert.equal(coreResult.cost, jsResult.cost, "core-ts == JS with intensity");
  assert.equal(coreResult.lineItems[0].quantity, 2);
}

// ── String shorthand motivations (core-ts supports, JS does not) ──

{
  const motivations = ["reflexive", "attacking"];
  const coreResult = calculateMotivationStackCostFromCore(core, motivations);
  // reflexive(25) + attacking(25) = 50
  assert.equal(coreResult.cost, 50, "string shorthand total = 50");
  assert.equal(coreResult.lineItems.length, 2, "two line items from strings");
  assert.equal(coreResult.lineItems[0].motivationKind, "reflexive");
  assert.equal(coreResult.lineItems[1].motivationKind, "attacking");
}

// ── Empty motivations ──

{
  const coreResult = calculateMotivationStackCostFromCore(core, []);
  assert.equal(coreResult.cost, 0, "empty = 0");
  assert.equal(coreResult.lineItems.length, 0, "empty line items");
}

// ── No core (graceful fallback) ──

{
  const coreResult = calculateMotivationStackCostFromCore(null, ["reflexive"]);
  assert.equal(coreResult.cost, 0, "null core = 0");
}

// ── All 12 kinds: core-ts matches JS defaults ──

{
  for (const [kindName, defaultCost] of Object.entries(DEFAULT_MOTIVATION_COSTS)) {
    const motivations = [{ kind: kindName, intensity: 1 }];
    const jsResult = calculateMotivationStackCost(motivations);
    const coreResult = calculateMotivationStackCostFromCore(core, motivations);
    assert.equal(
      coreResult.cost, jsResult.cost,
      kindName + ": core-ts (" + coreResult.cost + ") != JS (" + jsResult.cost + ")"
    );
  }
}

// ── Line item shape matches JS ──

{
  const motivations = [{ kind: "attacking", intensity: 3 }];
  const coreResult = calculateMotivationStackCostFromCore(core, motivations);
  const line = coreResult.lineItems[0];
  assert.equal(line.category, "motivation");
  assert.equal(line.id, "motivation_attacking");
  assert.equal(line.motivationKind, "attacking");
  assert.equal(line.family, "posture");
  assert.equal(line.label, "motivation:attacking");
  assert.equal(line.quantity, 3);
  assert.ok(line.unitCostTokens > 0);
  assert.equal(line.spendTokens, line.quantity * line.unitCostTokens);
}

console.log("allocator-motivation-cost: all assertions passed");
});

// ## TODO: Test Permutations
// - [ ] All 12 motivation kinds with intensity 1: verify core-ts == JS default cost
// - [ ] All 12 kinds with intensity 10 (max): verify core-ts == JS
// - [ ] Mixed string + object motivations: verify core-ts == JS
// - [ ] Duplicate kinds: verify each counted separately
// - [ ] Invalid kind names: verify skipped in core-ts and JS
// - [ ] Sequential calls: verify accumulator resets correctly
// - [ ] Control tier (user_controlled): verify cost = 10
// - [ ] calculateMotivationStackCostFromCore with priceMap is not supported: document gap
