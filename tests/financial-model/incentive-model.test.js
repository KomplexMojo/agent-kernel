const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const incentiveUrl = moduleUrl("packages/runtime/src/personas/allocator/incentive-model.js");

test("incentive multiplier: max(0, 1 - 1.25×|D/W - 0.8|) (design §3.3)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeIncentiveMultiplier } from ${JSON.stringify(incentiveUrl)};

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
`);
});

test("target delver/warden ratio is 0.8 (design §3.2)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { TARGET_DELVER_WARDEN_RATIO } from ${JSON.stringify(incentiveUrl)};
assert.equal(TARGET_DELVER_WARDEN_RATIO, 0.8);
`);
});

test("reference budget is 1000 (design §2.1)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { REFERENCE_BUDGET_TOKENS } from ${JSON.stringify(incentiveUrl)};
assert.equal(REFERENCE_BUDGET_TOKENS, 1000);
`);
});

test("reference targets: rooms=550, delvers=200, wardens=250 (design §2.2)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { REFERENCE_TARGETS } from ${JSON.stringify(incentiveUrl)};
assert.equal(REFERENCE_TARGETS.rooms, 550);
assert.equal(REFERENCE_TARGETS.delvers, 200);
assert.equal(REFERENCE_TARGETS.wardens, 250);
`);
});

test("scenario spend report includes all required fields (design §14)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { buildScenarioSpendReport } from ${JSON.stringify(incentiveUrl)};

const report = buildScenarioSpendReport({
  roomsSpend: 500,
  delverSpend: 180,
  wardenSpend: 230,
});

// Budget
assert.equal(report.budget, 1000);
assert.equal(report.totalSpend, 910);
assert.equal(report.remainingBudget, 90);
assert.equal(report.overBudget, false);

// Categories
assert.equal(report.categories.rooms.actual, 500);
assert.equal(report.categories.rooms.target, 550);
assert.equal(report.categories.delvers.actual, 180);
assert.equal(report.categories.delvers.target, 200);
assert.equal(report.categories.wardens.actual, 230);
assert.equal(report.categories.wardens.target, 250);

// Incentive
assert.equal(typeof report.incentive.actualRatio, "number");
assert.equal(report.incentive.targetRatio, 0.8);
assert.equal(typeof report.incentive.multiplier, "number");
assert.ok(report.incentive.multiplier > 0);
assert.ok(report.incentive.multiplier <= 1);
`);
});
