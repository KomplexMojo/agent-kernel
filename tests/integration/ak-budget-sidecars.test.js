const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const BUDGET = resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json");
const PRICE_LIST = resolve(ROOT, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json");

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
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

test("ak create with explicit --price-list wires the receipt to that list", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-budget-sidecars-price-list-"));
  runCliOk([
    "create",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1;motivation=attacking",
    "--text",
    "Explicit price list test",
    "--budget-tokens",
    "1000",
    "--budget",
    BUDGET,
    "--price-list",
    PRICE_LIST,
    "--run-id",
    "run_budget_price_list_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  assert.equal(receipt.priceListRef.id, "price_list_basic");
});

test("ak create --dry-run with --budget-tokens reports estimate without writing sidecars", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-budget-sidecars-dry-run-"));
  const result = runCliOk([
    "create",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1;motivation=attacking",
    "--text",
    "Budget dry-run sidecar test",
    "--budget-tokens",
    "500",
    "--run-id",
    "run_budget_dry_run_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
    "--dry-run",
  ]);
  const output = JSON.parse(result.stdout);

  assert.equal(output.ok, true);
  assert.equal(output.dryRun, true);
  assert.ok(output.budgetEstimate);
  assert.equal(existsSync(join(outDir, "spend-proposal.json")), false);
  assert.equal(existsSync(join(outDir, "budget-receipt.json")), false);
});

test("ak configure with --budget-tokens writes the same budget sidecars as create", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-budget-sidecars-configure-"));
  runCliOk([
    "configure",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1;motivation=exploring",
    "--text",
    "Budget configure sidecar test",
    "--budget-tokens",
    "500",
    "--run-id",
    "run_budget_configure_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  assert.equal(existsSync(join(outDir, "spend-proposal.json")), true);
  assert.equal(existsSync(join(outDir, "budget-receipt.json")), true);
});

test("spend-proposal.json content includes created room tiles and delver costs", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-budget-sidecars-proposal-"));
  runCliOk([
    "create",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1;motivation=attacking",
    "--text",
    "Budget proposal content test",
    "--budget-tokens",
    "500",
    "--run-id",
    "run_budget_proposal_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const proposal = readJson(join(outDir, "spend-proposal.json"));
  assert.ok(proposal.items.some((item) => item.id === "tile_floor" && item.category === "floor_tiles"));
  assert.ok(proposal.items.some((item) => item.category === "delvers"));
});

test("budget-receipt.json status is approved when budget is sufficient", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-budget-sidecars-approved-"));
  runCliOk([
    "create",
    "--room",
    "size=small;count=1",
    "--delver",
    "count=1;motivation=attacking",
    "--text",
    "Budget approved receipt test",
    "--budget-tokens",
    "500",
    "--run-id",
    "run_budget_approved_test",
    "--created-at",
    "2026-04-22T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const receipt = readJson(join(outDir, "budget-receipt.json"));
  assert.equal(receipt.status, "approved");
  assert.ok(receipt.remaining >= 0);
});
