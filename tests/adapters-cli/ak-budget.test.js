const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
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
