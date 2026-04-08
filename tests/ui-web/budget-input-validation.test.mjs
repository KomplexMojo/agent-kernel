import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateLevelBudget,
  validatePercentage,
  validateBudgetPercentages,
  normalizeBudgetInputs,
} from "../../packages/ui-web/src/budget-input-validation.js";

test("validateLevelBudget", async (t) => {
  await t.test("accepts valid budget values", () => {
    assert.equal(validateLevelBudget(0), 0);
    assert.equal(validateLevelBudget(1000), 1000);
    assert.equal(validateLevelBudget(100000), 100000);
    assert.equal(validateLevelBudget(50000), 50000);
  });

  await t.test("floors decimal values", () => {
    assert.equal(validateLevelBudget(1000.9), 1000);
    assert.equal(validateLevelBudget(1000.1), 1000);
  });

  await t.test("accepts string numbers", () => {
    assert.equal(validateLevelBudget("1000"), 1000);
    assert.equal(validateLevelBudget("50000"), 50000);
  });

  await t.test("rejects negative numbers", () => {
    assert.throws(() => validateLevelBudget(-1), /cannot be negative/);
    assert.throws(() => validateLevelBudget(-500), /cannot be negative/);
    assert.throws(() => validateLevelBudget("-1000"), /cannot be negative/);
  });

  await t.test("rejects values exceeding 100,000", () => {
    assert.throws(() => validateLevelBudget(100001), /cannot exceed 100,000/);
    assert.throws(() => validateLevelBudget(999999), /cannot exceed 100,000/);
    assert.throws(() => validateLevelBudget("150000"), /cannot exceed 100,000/);
  });

  await t.test("returns default value for invalid input", () => {
    assert.equal(validateLevelBudget("abc", 500), 500);
    assert.equal(validateLevelBudget(NaN, 500), 500);
    assert.equal(validateLevelBudget(null, 500), 500);
    assert.equal(validateLevelBudget(undefined, 500), 500);
  });

  await t.test("uses default value 1000 when not specified", () => {
    assert.equal(validateLevelBudget("abc"), 1000);
  });

  await t.test("boundary test: exactly 100,000 is valid", () => {
    assert.equal(validateLevelBudget(100000), 100000);
  });

  await t.test("boundary test: 0 is valid", () => {
    assert.equal(validateLevelBudget(0), 0);
  });
});

test("validatePercentage", async (t) => {
  await t.test("accepts valid percentage values", () => {
    assert.equal(validatePercentage(0), 0);
    assert.equal(validatePercentage(50), 50);
    assert.equal(validatePercentage(100), 100);
    assert.equal(validatePercentage(25), 25);
  });

  await t.test("floors decimal values", () => {
    assert.equal(validatePercentage(50.9), 50);
    assert.equal(validatePercentage(50.1), 50);
  });

  await t.test("accepts string percentages", () => {
    assert.equal(validatePercentage("50"), 50);
    assert.equal(validatePercentage("100"), 100);
  });

  await t.test("rejects negative percentages", () => {
    assert.throws(() => validatePercentage(-1), /cannot be negative/);
    assert.throws(() => validatePercentage(-50), /cannot be negative/);
    assert.throws(() => validatePercentage("-25"), /cannot be negative/);
  });

  await t.test("rejects percentages exceeding 100", () => {
    assert.throws(() => validatePercentage(101), /cannot exceed 100/);
    assert.throws(() => validatePercentage(150), /cannot exceed 100/);
    assert.throws(() => validatePercentage("200"), /cannot exceed 100/);
  });

  await t.test("returns default value for invalid input", () => {
    assert.equal(validatePercentage("abc", 25), 25);
    assert.equal(validatePercentage(NaN, 25), 25);
    assert.equal(validatePercentage(null, 25), 25);
  });

  await t.test("boundary test: exactly 100 is valid", () => {
    assert.equal(validatePercentage(100), 100);
  });

  await t.test("boundary test: 0 is valid", () => {
    assert.equal(validatePercentage(0), 0);
  });
});

test("validateBudgetPercentages", async (t) => {
  await t.test("accepts valid percentage distributions that sum to 100", () => {
    const result = validateBudgetPercentages({ room: 55, delver: 20, warden: 25 });
    assert.deepEqual(result, { room: 55, delver: 20, warden: 25 });
  });

  await t.test("accepts other valid distributions", () => {
    const result1 = validateBudgetPercentages({ room: 50, delver: 25, warden: 25 });
    assert.deepEqual(result1, { room: 50, delver: 25, warden: 25 });

    const result2 = validateBudgetPercentages({ room: 70, delver: 15, warden: 15 });
    assert.deepEqual(result2, { room: 70, delver: 15, warden: 15 });

    const result3 = validateBudgetPercentages({ room: 100, delver: 0, warden: 0 });
    assert.deepEqual(result3, { room: 100, delver: 0, warden: 0 });
  });

  await t.test("rejects percentages that don't sum to 100", () => {
    assert.throws(
      () => validateBudgetPercentages({ room: 50, delver: 25, warden: 19 }),
      /must sum to 100/
    );

    assert.throws(
      () => validateBudgetPercentages({ room: 70, delver: 20, warden: 15 }),
      /must sum to 100/
    );

    assert.throws(
      () => validateBudgetPercentages({ room: 33, delver: 33, warden: 33 }),
      /must sum to 100/
    );
  });

  await t.test("rejects when any percentage is negative", () => {
    assert.throws(
      () => validateBudgetPercentages({ room: -10, delver: 55, warden: 55 }),
      /cannot be negative/
    );

    assert.throws(
      () => validateBudgetPercentages({ room: 50, delver: -25, warden: 75 }),
      /cannot be negative/
    );
  });

  await t.test("rejects when any percentage exceeds 100", () => {
    assert.throws(
      () => validateBudgetPercentages({ room: 150, delver: 0, warden: -50 }),
      /cannot exceed 100/
    );
  });

  await t.test("handles string inputs", () => {
    const result = validateBudgetPercentages({ room: "55", delver: "20", warden: "25" });
    assert.deepEqual(result, { room: 55, delver: 20, warden: 25 });
  });

  await t.test("floors decimal values before summing", () => {
    const result = validateBudgetPercentages({ room: 55.9, delver: 20.1, warden: 25.1 });
    assert.deepEqual(result, { room: 55, delver: 20, warden: 25 });
  });

  await t.test("provides detailed error message", () => {
    try {
      validateBudgetPercentages({ room: 50, delver: 30, warden: 30 });
      assert.fail("Should have thrown");
    } catch (error) {
      assert.match(error.message, /room: 50%, delver: 30%, warden: 30%/);
      assert.match(error.message, /110%/);
    }
  });
});

test("normalizeBudgetInputs", async (t) => {
  await t.test("accepts valid inputs with correct defaults", () => {
    const result = normalizeBudgetInputs({
      levelBudget: 1000,
      roomPercent: 55,
      delverPercent: 20,
      wardenPercent: 25,
    });

    assert.deepEqual(result, {
      levelBudget: 1000,
      percentages: { room: 55, delver: 20, warden: 25 },
    });
  });

  await t.test("applies default values when not provided", () => {
    const result = normalizeBudgetInputs();
    assert.deepEqual(result, {
      levelBudget: 1000,
      percentages: { room: 55, delver: 20, warden: 25 },
    });
  });

  await t.test("rejects invalid level budget", () => {
    assert.throws(
      () =>
        normalizeBudgetInputs({
          levelBudget: -500,
          roomPercent: 55,
          delverPercent: 20,
          wardenPercent: 25,
        }),
      /cannot be negative/
    );
  });

  await t.test("rejects invalid percentage distribution", () => {
    assert.throws(
      () =>
        normalizeBudgetInputs({
          levelBudget: 1000,
          roomPercent: 50,
          delverPercent: 25,
          wardenPercent: 20,
        }),
      /must sum to 100/
    );
  });

  await t.test("accepts extreme but valid level budgets", () => {
    const result1 = normalizeBudgetInputs({
      levelBudget: 0,
      roomPercent: 55,
      delverPercent: 20,
      wardenPercent: 25,
    });
    assert.equal(result1.levelBudget, 0);

    const result2 = normalizeBudgetInputs({
      levelBudget: 100000,
      roomPercent: 55,
      delverPercent: 20,
      wardenPercent: 25,
    });
    assert.equal(result2.levelBudget, 100000);
  });

  await t.test("handles string inputs correctly", () => {
    const result = normalizeBudgetInputs({
      levelBudget: "2000",
      roomPercent: "60",
      delverPercent: "20",
      wardenPercent: "20",
    });

    assert.deepEqual(result, {
      levelBudget: 2000,
      percentages: { room: 60, delver: 20, warden: 20 },
    });
  });
});

test("Integration: Real-world scenarios", async (t) => {
  await t.test("Scenario: Adjusting budget from UI test screenshot #11", () => {
    // From test screenshot: adjusting level budget from 1000 to 2000
    const result = normalizeBudgetInputs({
      levelBudget: 2000,
      roomPercent: 55,
      delverPercent: 20,
      wardenPercent: 25,
    });

    assert.equal(result.levelBudget, 2000);
    assert.deepEqual(result.percentages, { room: 55, delver: 20, warden: 25 });
  });

  await t.test("Scenario: Adjusting room percentage from UI test screenshot #12", () => {
    // From test screenshot: adjusting room % from 55 to 70
    const result = normalizeBudgetInputs({
      levelBudget: 1000,
      roomPercent: 70,
      delverPercent: 15,
      wardenPercent: 15,
    });

    assert.equal(result.levelBudget, 1000);
    assert.deepEqual(result.percentages, { room: 70, delver: 15, warden: 15 });
  });

  await t.test("Scenario: Very large budget from UI test screenshot #19", () => {
    // From test screenshot: entering 999999 should be rejected
    assert.throws(
      () =>
        normalizeBudgetInputs({
          levelBudget: 999999,
          roomPercent: 55,
          delverPercent: 20,
          wardenPercent: 25,
        }),
      /cannot exceed 100,000/
    );
  });

  await t.test("Scenario: Negative budget from UI test screenshot #13", () => {
    // From test screenshot: entering -500 should be rejected
    assert.throws(
      () =>
        normalizeBudgetInputs({
          levelBudget: -500,
          roomPercent: 55,
          delverPercent: 20,
          wardenPercent: 25,
        }),
      /cannot be negative/
    );
  });

  await t.test("Scenario: Unbalanced percentages should be rejected", () => {
    // User sets room: 70, delver: 20, warden: 25 = 115% (invalid)
    assert.throws(
      () =>
        normalizeBudgetInputs({
          levelBudget: 1000,
          roomPercent: 70,
          delverPercent: 20,
          wardenPercent: 25,
        }),
      /must sum to 100/
    );
  });

  await t.test("Scenario: All budget to rooms", () => {
    const result = normalizeBudgetInputs({
      levelBudget: 5000,
      roomPercent: 100,
      delverPercent: 0,
      wardenPercent: 0,
    });

    assert.equal(result.levelBudget, 5000);
    assert.deepEqual(result.percentages, { room: 100, delver: 0, warden: 0 });
  });

  await t.test("Scenario: Maximum budget with balanced split", () => {
    const result = normalizeBudgetInputs({
      levelBudget: 100000,
      roomPercent: 50,
      delverPercent: 25,
      wardenPercent: 25,
    });

    assert.equal(result.levelBudget, 100000);
    assert.deepEqual(result.percentages, { room: 50, delver: 25, warden: 25 });
  });
});
