const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCliRaw(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function runCli(args, options = {}) {
  const result = runCliRaw(args, options);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

function makeTempDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

test("cli budget prints and writes budget artifacts", () => {
  const outDir = makeTempDir("agent-kernel-budget-");
  const budgetPath = resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json");
  const priceListPath = resolve(ROOT, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json");
  const receiptPath = resolve(ROOT, "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json");

  const result = runCli([
    "budget",
    "--budget",
    budgetPath,
    "--price-list",
    priceListPath,
    "--receipt",
    receiptPath,
    "--out-dir",
    outDir,
  ]);

  const output = JSON.parse(result.stdout);
  assert.equal(output.budget.schema, "agent-kernel/BudgetArtifact");
  assert.equal(output.priceList.schema, "agent-kernel/PriceList");
  assert.equal(output.receipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.ok(existsSync(join(outDir, "budget.json")));
  assert.ok(existsSync(join(outDir, "price-list.json")));
  assert.ok(existsSync(join(outDir, "budget-receipt.json")));
});

test("budget accepts a budget artifact without requiring a price list or receipt", () => {
  const budgetPath = resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json");

  const result = runCli(["budget", "--budget", budgetPath]);
  const output = JSON.parse(result.stdout);

  assert.equal(output.ok, true);
  assert.equal(output.command, "budget");
  assert.equal(output.budget.schema, "agent-kernel/BudgetArtifact");
  assert.equal(output.priceList, undefined);
  assert.equal(output.receipt, undefined);
});

test("budget with a missing receipt path returns ok:false with a stable filesystem error", () => {
  const missingReceipt = join(makeTempDir("agent-kernel-budget-missing-receipt-"), "missing.json");

  const result = runCliRaw(["budget", "--receipt", missingReceipt]);

  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "budget");
  assert.match(output.error, /ENOENT|no such file/i);
  assert.match(output.error, /missing\.json/);
});
