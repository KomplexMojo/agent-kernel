// #282: a budget fill must never exceed the budget it fills. delver-plan grew singular-affinity
// delvers toward an explicit budget and its own receipt then denied the plan, because the fill
// priced the cards without their affinity and without the Configurator's vital floors.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

// 312 is these three cards' floor since #340 priced intensity apart (it was under 300 before).
test.each([312, 1000, 2500, 5000, 10000])("delver-plan filled to %i tokens is approved by its own receipt", (budget) => {
  const dir = mkdtempSync(join(tmpdir(), "allocator-fill-"));
  try {
    const result = spawnSync(process.execPath, [CLI, "delver-plan",
      "--delver", "affinity=fire;motivation=attacking;count=2",
      "--delver", "affinity=earth;motivation=patrolling;count=1",
      "--budget-tokens", String(budget), "--created-at", "2026-10-17T00:00:00.000Z", "--out-dir", dir],
    { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
    const receipt = JSON.parse(readFileSync(join(dir, "budget-receipt.json"), "utf8"));
    assert.equal(receipt.status, "approved");
    assert.ok(receipt.totalCost <= budget, `spent ${receipt.totalCost} of ${budget}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ## TODO: Test Permutations
// - room-plan with sizeFlexible rooms filled to an explicit budget stays within it.
// - delver cards with an explicit affinities list and a singular affinity price the list only.
// - ak create with --budget-tokens and singular-affinity delvers is approved at small budgets.
