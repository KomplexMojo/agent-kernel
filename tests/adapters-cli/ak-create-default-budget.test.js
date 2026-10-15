// #274: a level made with no budget still goes through the Allocator. With no
// --budget-tokens, --budget or budget text, `ak create` applies the Allocator's reference
// budget (levelAuthoring().referenceBudgetTokens, 2500), so the level is priced and has a
// receipt, and a level that does not fit it is refused like any other overspend.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function run(args) {
  const dir = mkdtempSync(join(tmpdir(), "ak-default-budget-"));
  const result = spawnSync(process.execPath, [CLI, ...args, "--created-at", "2026-10-15T00:00:00.000Z", "--out-dir", dir],
    { cwd: ROOT, encoding: "utf8" });
  return { result, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("ak create with no budget is priced against the Allocator's reference budget", async () => {
  const { createAllocatorPersona } = await import("../../packages/runtime/src/personas/allocator/persona.js");
  const reference = createAllocatorPersona({ clock: () => 0 }).pricing.levelAuthoring().referenceBudgetTokens;
  assert.equal(reference, 2500, "Darren's default (2026-10-15)");
  const run1 = run(["create", "--room", "size=medium;count=2",
    "--delver", "count=1;id=hero;motivation=user_controlled", "--warden", "count=1;id=guard;motivation=stationary"]);
  try {
    assert.equal(run1.result.status, 0, run1.result.stderr);
    for (const file of ["price-list.json", "budget.json", "budget-receipt.json"]) {
      assert.ok(existsSync(join(run1.dir, file)), `${file} is written`);
    }
    const receipt = JSON.parse(readFileSync(join(run1.dir, "budget-receipt.json"), "utf8"));
    assert.equal(receipt.status, "approved");
    assert.equal(receipt.totalCost + receipt.remaining, reference);
  } finally {
    run1.cleanup();
  }
});

test("a level too big for the default budget is refused, not built unpriced", () => {
  const run1 = run(["create", "--room", "size=large;count=2",
    "--delver", "count=6;id=hero;motivation=user_controlled;vitals=health:60:5,mana:60:5,stamina:20:2,durability:20:2"]);
  try {
    assert.notEqual(run1.result.status, 0, "over the default budget");
    assert.match(`${run1.result.stderr}${run1.result.stdout}`, /budget/i);
  } finally {
    run1.cleanup();
  }
});

test("room-plan with no budget is priced too", () => {
  const run1 = run(["room-plan", "--room", "size=small;count=1"]);
  try {
    assert.equal(run1.result.status, 0, run1.result.stderr);
    assert.ok(existsSync(join(run1.dir, "budget-receipt.json")), "room-plan writes a receipt");
  } finally {
    run1.cleanup();
  }
});

// ## TODO: Test Permutations
// - hazard-plan, resource-plan, delver-plan and warden-plan with no budget each write a receipt.
// - ak create --dry-run with no budget reports budgetEstimate.total 2500.
// - ak_create (MCP) with no budget writes a receipt.
// - an explicit --budget-tokens still wins over the default.
