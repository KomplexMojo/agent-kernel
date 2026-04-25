const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
}

function runCliOk(args) {
  const result = runCli(args);
  if (result.status !== 0) {
    throw new Error(`CLI failed (${result.status}): ${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return result;
}

test("ak create with --budget-tokens writes spend-proposal.json by default", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-budget-sidecars-"));
  runCliOk([
    "create",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1;motivation=attacking",
    "--text",
    "Budget sidecar test",
    "--budget-tokens",
    "500",
    "--run-id",
    "run_budget_sidecars_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.ok(
    existsSync(join(outDir, "spend-proposal.json")),
    "spend-proposal.json must be written by default when budget-tokens is present",
  );
});

test("ak create with --budget-tokens writes budget-receipt.json by default", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-budget-sidecars-receipt-"));
  runCliOk([
    "create",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1;motivation=exploring",
    "--text",
    "Budget receipt test",
    "--budget-tokens",
    "500",
    "--run-id",
    "run_budget_receipt_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.ok(
    existsSync(join(outDir, "budget-receipt.json")),
    "budget-receipt.json must be written by default when budget-tokens is present",
  );
});

test("ak create without --budget-tokens does not write spend-proposal.json", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-no-budget-"));
  runCliOk([
    "create",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1",
    "--text",
    "No budget test",
    "--run-id",
    "run_no_budget_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.equal(
    existsSync(join(outDir, "spend-proposal.json")),
    false,
    "spend-proposal.json must NOT be written when no budget is present",
  );
});

// ## TODO: Test Permutations
// - ak create with explicit --price-list file: spend-proposal.json uses that list, not the default
// - ak create --dry-run with --budget-tokens: reports budget summary without writing sidecars to disk
// - ak configure with --budget-tokens: same sidecar behavior as create
// - spend-proposal.json content has items matching created room + delver
// - budget-receipt.json status is "approved" when budget is sufficient
