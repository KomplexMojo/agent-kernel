const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/level-generation-benchmark.mjs");

test("level generation benchmark script reports walkability budgets", () => {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--budgets",
      "10000",
      "--runs",
      "1",
      "--layout-percent",
      "55",
      "--json",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.layoutPercent, 55);
  assert.ok(Array.isArray(output.sweep));
  assert.equal(output.sweep.length, 1);
  assert.equal(output.sweep[0].totalBudgetTokens, 10000);
  assert.equal(output.sweep[0].walkabilityBudgetTokens, 5500);
  assert.equal(output.sweep[0].runs, 1);
  assert.equal(output.sweep[0].successRuns, 1);
  assert.equal(output.sweep[0].failureRuns, 0);
  assert.equal(output.maxSuccessful.totalBudgetTokens, 10000);
  assert.equal(output.maxSuccessful.walkabilityBudgetTokens, 5500);
});
