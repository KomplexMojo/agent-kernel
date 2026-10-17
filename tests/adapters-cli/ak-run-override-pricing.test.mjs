// #278: `ak run --actor/--vital/--tile-*` change a built level after the Allocator priced it.
// The Allocator re-prices the changed level against the level's own budget and issues a new
// receipt; a level the change takes over budget still runs, and the overspend is reported.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const ak = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
const lastJson = (stdout) => JSON.parse(stdout.trim().split("\n").at(-1));

let dir;
let level;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ak-run-override-pricing-"));
  level = join(dir, "level");
  const created = ak(["create", "--room", "size=small;count=1",
    "--delver", "count=1;affinity=wind;motivation=exploring+user_controlled",
    "--run-id", "override_pricing", "--created-at", "2026-10-17T00:00:00.000Z", "--out-dir", level]);
  assert.equal(created.status, 0, created.stderr);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(name, overrides) {
  const outDir = join(dir, name);
  const result = ak(["run", "--sim-config", join(level, "sim-config.json"),
    "--initial-state", join(level, "initial-state.json"), "--ticks", "0", ...overrides, "--out-dir", outDir]);
  return { result, outDir };
}

test("an added actor is priced by the Allocator against the level's own budget", () => {
  const original = readJson(join(level, "budget-receipt.json"));
  const { result, outDir } = run("added", ["--actor", "extra_1,2,2,delver"]);
  assert.equal(result.status, 0, result.stderr);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  const spawns = receipt.lineItems.filter((item) => item.id === "actor_spawn").map((item) => item.subjectRef.id);
  assert.deepEqual(spawns.sort(), ["card_delver_1-1", "extra_1"]);
  assert.equal(receipt.totalCost + receipt.remaining, original.totalCost + original.remaining);
  assert.ok(receipt.totalCost > original.totalCost);
  assert.equal(readJson(join(outDir, "resolved-sim-config.json")).budgetReceiptRef.id, receipt.meta.id);
  assert.equal(lastJson(result.stdout).artifactPaths.budget_receipt, join(outDir, "budget-receipt.json"));
});

test("an override that overspends the budget still runs, and the overspend is reported", () => {
  const { result, outDir } = run("overspent", ["--vital", "card_delver_1-1,health,5000,5000,1"]);
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(readJson(join(outDir, "budget-receipt.json")).status, "approved");
  const payload = lastJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.pricingReport[0].code, "overrides_over_budget");
});

test("a run with no overrides writes no new receipt", () => {
  const { result, outDir } = run("plain", []);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lastJson(result.stdout).artifactPaths.budget_receipt, undefined);
  assert.equal(lastJson(result.stdout).pricingReport, undefined);
  void outDir;
});

// ## TODO: Test Permutations
// - a hand-written level (no receipt beside it) with overrides is priced against the reference budget.
// - --tile-wall / --tile-floor change the receipt's floor-tile count.
// - an override run with --out-dir equal to the level directory replaces the level's receipt.
