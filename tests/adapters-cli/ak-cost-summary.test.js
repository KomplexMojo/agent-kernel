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

function parseStdout(result) {
  return JSON.parse(result.stdout.trim());
}

test("ak create with --budget-tokens emits top-level cost summary", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-cost-summary-create-"));
  const result = runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;motivation=attacking",
    "--text", "Cost summary test",
    "--budget-tokens", "1000",
    "--run-id", "run_cost_summary_create",
    "--created-at", "2026-04-22T00:00:00.000Z",
    "--out-dir", outDir,
  ]);
  const summary = parseStdout(result);
  assert.ok(summary.cost, "create output must include a top-level cost field when budget is present");
  assert.ok(Number.isInteger(summary.cost.totalSpend), "cost.totalSpend must be an integer");
  assert.ok(Number.isInteger(summary.cost.budgetTokens), "cost.budgetTokens must be an integer");
  assert.equal(summary.cost.budgetTokens, 1000, "cost.budgetTokens must equal the --budget-tokens value");
  assert.ok(Number.isInteger(summary.cost.remaining), "cost.remaining must be an integer");
  assert.ok(typeof summary.cost.status === "string", "cost.status must be a string");
  assert.ok(typeof summary.cost.receiptPath === "string", "cost.receiptPath must be a string");
  assert.ok(typeof summary.cost.proposalPath === "string", "cost.proposalPath must be a string");
  assert.ok(existsSync(summary.cost.receiptPath), "cost.receiptPath must point to an existing file");
  assert.ok(existsSync(summary.cost.proposalPath), "cost.proposalPath must point to an existing file");
});

test("ak create without --budget-tokens omits cost field", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-cost-summary-no-budget-"));
  const result = runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1",
    "--text", "No budget test",
    "--run-id", "run_cost_summary_no_budget",
    "--created-at", "2026-04-22T00:00:00.000Z",
    "--out-dir", outDir,
  ]);
  const summary = parseStdout(result);
  assert.equal(summary.cost, undefined, "cost field must be absent when no budget is supplied");
});

test("ak create cost.totalSpend + cost.remaining equals cost.budgetTokens", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-cost-budget-math-"));
  const result = runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;motivation=exploring",
    "--budget-tokens", "1000",
    "--run-id", "run_cost_budget_math",
    "--created-at", "2026-04-22T00:00:00.000Z",
    "--out-dir", outDir,
  ]);
  const summary = parseStdout(result);
  assert.ok(summary.cost, "cost field must be present");
  assert.equal(
    summary.cost.totalSpend + summary.cost.remaining,
    summary.cost.budgetTokens,
    "totalSpend + remaining must equal budgetTokens",
  );
});

// ## TODO: Test Permutations
// - ak show with a run that has budget artifacts: budgetSpend includes receiptPath and proposalPath
// - ak show with a run that has no budget artifacts: no cost/budgetSpend in output
// - ak runs list: each entry with a budget run includes a cost summary
// - ak create --dry-run with --budget-tokens: cost is estimated in dry-run output, no paths written
// - cost.status is "approved" when totalSpend <= budgetTokens and all line items approved
// - cost.status is "partial" when some line items are denied
