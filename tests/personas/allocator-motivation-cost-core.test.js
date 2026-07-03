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

test("motivation cost delegation permutations", async () => {
const { createCore } = await import("../../packages/core-ts/src/index.ts");
const {
  calculateMotivationStackCost,
  calculateMotivationStackCostFromCore,
  MOTIVATION_KIND_TO_CODE,
  DEFAULT_MOTIVATION_COSTS,
} = await import("../../packages/runtime/src/personas/allocator/motivation-price-policy.js");

const core = createCore();
core.init(0);
const kinds = Object.keys(MOTIVATION_KIND_TO_CODE);

for (const kind of kinds) {
  const motivations = [{ kind, intensity: 1 }];
  assert.deepEqual(
    calculateMotivationStackCostFromCore(core, motivations),
    calculateMotivationStackCost(motivations),
    `${kind} intensity 1 matches JS`,
  );
}

for (const kind of kinds) {
  const motivations = [{ kind, intensity: 10 }];
  assert.deepEqual(
    calculateMotivationStackCostFromCore(core, motivations),
    calculateMotivationStackCost(motivations),
    `${kind} intensity 10 matches JS`,
  );
}

{
  const mixedForCore = ["reflexive", { kind: "attacking", intensity: 2 }];
  const normalizedForJs = [{ kind: "reflexive", intensity: 1 }, { kind: "attacking", intensity: 2 }];
  assert.deepEqual(
    calculateMotivationStackCostFromCore(core, mixedForCore),
    calculateMotivationStackCost(normalizedForJs),
  );
}

{
  const motivations = [{ kind: "attacking", intensity: 1 }, { kind: "attacking", intensity: 2 }];
  const result = calculateMotivationStackCostFromCore(core, motivations);
  assert.equal(result.cost, DEFAULT_MOTIVATION_COSTS.attacking * 3);
  assert.equal(result.lineItems.length, 2);
  assert.deepEqual(result.lineItems.map((line) => line.quantity), [1, 2]);
}

{
  const motivations = [{ kind: "invalid", intensity: 99 }, "also_invalid"];
  assert.deepEqual(calculateMotivationStackCostFromCore(core, motivations), { cost: 0, lineItems: [] });
  assert.deepEqual(calculateMotivationStackCost(motivations), { cost: 0, lineItems: [] });
}

calculateMotivationStackCostFromCore(core, [{ kind: "strategy_focused", intensity: 10 }]);
const resetResult = calculateMotivationStackCostFromCore(core, [{ kind: "random", intensity: 1 }]);
assert.equal(resetResult.cost, DEFAULT_MOTIVATION_COSTS.random);
assert.equal(resetResult.lineItems.length, 1);
assert.equal(resetResult.lineItems[0].motivationKind, "random");

{
  const result = calculateMotivationStackCostFromCore(core, [{ kind: "user_controlled", intensity: 1 }]);
  assert.equal(result.cost, 10);
  assert.equal(result.lineItems[0].unitCostTokens, 10);
}

{
  const priceMap = new Map([["motivation:motivation_attacking", 999]]);
  const jsOverride = calculateMotivationStackCost([{ kind: "attacking", intensity: 1 }], priceMap);
  const coreDefault = calculateMotivationStackCostFromCore(core, [{ kind: "attacking", intensity: 1 }], priceMap);
  assert.equal(jsOverride.cost, 999);
  assert.equal(coreDefault.cost, DEFAULT_MOTIVATION_COSTS.attacking);
}
});
