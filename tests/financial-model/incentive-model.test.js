const assert = require("node:assert/strict");


test("incentive multiplier: max(0, async 1 - 1.25×|D/W - 0.8|) (design §3.3)", async () => {
  const { computeIncentiveMultiplier } = await import("../../packages/runtime/src/personas/allocator/incentive-model.js");

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
  const { TARGET_DELVER_WARDEN_RATIO } = await import("../../packages/runtime/src/personas/allocator/incentive-model.js");
assert.equal(TARGET_DELVER_WARDEN_RATIO, 0.8);
});

test("reference budget is 2500 (design §2.1)", async () => {
  const { REFERENCE_BUDGET_TOKENS } = await import("../../packages/runtime/src/personas/allocator/incentive-model.js");
assert.equal(REFERENCE_BUDGET_TOKENS, 2500);
});

test("reference targets include five budget pools for the 2500-token budget (design §2.2)", async () => {
  const { REFERENCE_TARGETS } = await import("../../packages/runtime/src/personas/allocator/incentive-model.js");
assert.equal(REFERENCE_TARGETS.rooms, 1100);
assert.equal(REFERENCE_TARGETS.delvers, 500);
assert.equal(REFERENCE_TARGETS.wardens, 400);
assert.equal(REFERENCE_TARGETS.hazards, 300);
assert.equal(REFERENCE_TARGETS.resources, 200);
});

test("scenario spend report includes all required fields (design §14)", async () => {
  const { buildScenarioSpendReport } = await import("../../packages/runtime/src/personas/allocator/incentive-model.js");

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
assert.equal(report.categories.rooms.target, 1100);
assert.equal(report.categories.delvers.actual, 180);
assert.equal(report.categories.delvers.target, 500);
assert.equal(report.categories.wardens.actual, 230);
assert.equal(report.categories.wardens.target, 400);

// Incentive
assert.equal(typeof report.incentive.actualRatio, "number");
assert.equal(report.incentive.targetRatio, 0.8);
assert.equal(typeof report.incentive.multiplier, "number");
assert.ok(report.incentive.multiplier > 0);
assert.ok(report.incentive.multiplier <= 1);
});

test("scenario spend report scales default allocation targets for a 10000-token budget", async () => {
  const { buildScenarioSpendReport } = await import("../../packages/runtime/src/personas/allocator/incentive-model.js");

const report = buildScenarioSpendReport({ budgetTokens: 10000 });

assert.equal(report.categories.rooms.target, 4400);
assert.equal(report.categories.floor_tiles.target, 4400);
assert.equal(report.categories.traps.target, 4400);
assert.equal(report.categories.delvers.target, 2000);
assert.equal(report.categories.wardens.target, 1600);
assert.equal(report.categories.hazards.target, 1200);
assert.equal(report.categories.resources.target, 800);
});
