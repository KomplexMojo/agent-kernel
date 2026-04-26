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

// ## TODO: Test Permutations
// - Permutation: budget without --price-list — confirm a clear error envelope (GAP-4 evidence:
//   currently display-only, but the input contract should still validate inputs).
// - Permutation: budget against a price list whose items use legacy `costTokens` only — confirm
//   the receipt resolves real unitCost values (BUG-2 regression guard once normalizePriceItems is
//   adopted by buildPriceMap).
// - Permutation: budget against a price list whose items use canonical `unitCost` — confirm parity
//   with the legacy-only case (no field-name divergence in the rendered receipt).
// - Permutation: budget with a receipt path that is missing — confirm the CLI does not crash and
//   instead returns ok:false with a stable reason.
// - Permutation: budget --out-dir present but no write side effects expected (GAP-4) — assert that
//   the documented limitation still holds and is reported, not silently bypassed.
