const assert = require("node:assert/strict");


test("incentive multiplier: max(0, async 1 - 1.25×|D/W - 0.8|) (design §3.3)", async () => {
  const { computeIncentiveMultiplier } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");

// Perfect ratio: D/W = 0.8 → multiplier = 1.0
assert.equal(computeIncentiveMultiplier(200, 250), 1.0);

// Exact ratio: D=160, W=200 → 160/200 = 0.8 → 1.0
assert.equal(computeIncentiveMultiplier(160, 200), 1.0);

// Zero warden spend → 0
assert.equal(computeIncentiveMultiplier(100, 0), 0);

// Far off ratio → clamps to 0
assert.equal(computeIncentiveMultiplier(500, 100), 0);

// Slightly off: D=220, W=250 → 0.88 → |0.88-0.8| = 0.08 → 1 - 0.1 = 0.9
const m = computeIncentiveMultiplier(220, 250);
assert.ok(Math.abs(m - 0.9) < 0.001);
});

test("target delver/warden ratio is 0.8 (design §3.2)", async () => {
  const { TARGET_DELVER_WARDEN_RATIO } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");
assert.equal(TARGET_DELVER_WARDEN_RATIO, 0.8);
});

test("reference budget is 2500 (design §2.1)", async () => {
  const { REFERENCE_BUDGET_TOKENS } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");
assert.equal(REFERENCE_BUDGET_TOKENS, 2500);
});

test("reference targets include five budget pools for the 2500-token budget (design §2.2)", async () => {
  const { REFERENCE_TARGETS } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");
assert.equal(REFERENCE_TARGETS.rooms, 725);
assert.equal(REFERENCE_TARGETS.delvers, 625);
assert.equal(REFERENCE_TARGETS.wardens, 575);
assert.equal(REFERENCE_TARGETS.hazards, 375);
assert.equal(REFERENCE_TARGETS.resources, 200);
});

test("scenario spend report includes all required fields (design §14)", async () => {
  const { buildScenarioSpendReport } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");

const report = buildScenarioSpendReport({
  roomsSpend: 500,
  delverSpend: 180,
  wardenSpend: 230,
});

// Budget
assert.equal(report.budget, 2500);
assert.equal(report.totalSpend, 910);
assert.equal(report.remainingBudget, 1590);
assert.equal(report.overBudget, false);

// Categories
assert.equal(report.categories.rooms.actual, 500);
assert.equal(report.categories.rooms.target, 725);
assert.equal(report.categories.delvers.actual, 180);
assert.equal(report.categories.delvers.target, 625);
assert.equal(report.categories.wardens.actual, 230);
assert.equal(report.categories.wardens.target, 575);

// Incentive
assert.equal(typeof report.incentive.actualRatio, "number");
assert.equal(report.incentive.targetRatio, 0.8);
assert.equal(typeof report.incentive.multiplier, "number");
assert.ok(report.incentive.multiplier > 0);
assert.ok(report.incentive.multiplier <= 1);
});

test("scenario spend report scales default allocation targets for a 10000-token budget", async () => {
  const { buildScenarioSpendReport } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");

const report = buildScenarioSpendReport({ budgetTokens: 10000 });

assert.equal(report.categories.rooms.target, 2900);
assert.equal(report.categories.floor_tiles.target, 2900);
assert.equal(report.categories.delvers.target, 2500);
assert.equal(report.categories.wardens.target, 2300);
assert.equal(report.categories.hazards.target, 1500);
assert.equal(report.categories.resources.target, 800);
});

/**
 * The `rooms` ROW is a pool rollup, and it must absorb exactly the categories that draw on
 * the rooms POOL.
 *
 * It was hand-written as `floor_tiles + hazards + shared_system` and had gone stale: hazards
 * have had their own pool (15% of the dungeon split) and their own row with their own target
 * since the split, so folding them into `rooms` reported the same tokens twice and compared a
 * hazards-inclusive actual against a hazards-exclusive target. Golden create-g1 recorded it —
 * `rooms.actual` was 67 for a build whose only room-pool spend was 25 tokens of floor tiles.
 */
test("the rooms row rolls up the rooms POOL, and hazards are not part of it", async () => {
  const { buildScenarioSpendReport } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");

  const report = buildScenarioSpendReport({
    lineItems: [
      { category: "floor_tiles", totalCost: 25 },
      { category: "hazards", totalCost: 42 },
      { category: "delvers", totalCost: 56 },
    ],
    budgetTokens: 5000,
  });

  // 25 (floor_tiles) — NOT 67, which is what including hazards produced.
  assert.equal(report.categories.rooms.actual, 25);
  assert.equal(report.categories.hazards.actual, 42);
  // The money is unchanged either way: totalSpend comes from the line items.
  assert.equal(report.totalSpend, 123);
});

test("floor_tiles and shared_system DO roll up into rooms — they share its pool", async () => {
  const { buildScenarioSpendReport } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");

  const report = buildScenarioSpendReport({
    lineItems: [
      { category: "rooms", totalCost: 10 },
      { category: "floor_tiles", totalCost: 5 },
      { category: "shared_system", totalCost: 3 },
    ],
    budgetTokens: 5000,
  });

  assert.equal(report.categories.rooms.actual, 18);
});

/**
 * ⚠️ THE PATH WITH NO PRODUCER — which is exactly why this went unnoticed.
 *
 * When `lineItems` is absent, `totalSpend` is summed from the categories. That sum used to be
 * spelled out AFTER the rooms rollup as `spend.rooms + spend.hazards + …`, so once the rollup
 * absorbed hazards they were counted twice. Every caller in production supplies either
 * `lineItems` or a legacy shape whose `hazards` is 0, so the defect was unreachable today and
 * would have surfaced the first time anything passed an explicit categorySpend with hazards.
 */
test("with no lineItems, totalSpend counts every category exactly once", async () => {
  const { buildScenarioSpendReport } = await import("../../../packages/runtime/src/personas/allocator/incentive-model.js");

  const report = buildScenarioSpendReport({
    categorySpend: {
      rooms: 10, floor_tiles: 5, hazards: 40, resources: 0,
      delvers: 20, wardens: 25, shared_system: 0,
    },
    budgetTokens: 5000,
  });

  // 10+5+40+0+20+25+0 = 100. The double-counting form reported 140.
  assert.equal(report.totalSpend, 100);
  assert.equal(report.remainingBudget, 4900);
  assert.equal(report.categories.rooms.actual, 15);
});

// ## TODO: Test Permutations
