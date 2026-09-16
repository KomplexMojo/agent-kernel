const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ...(options.env || {}) },
  });
}

function runCliOk(args, options) {
  const result = runCli(args, options);
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

test("ak show with budget artifacts includes budgetSpend", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-cost-show-budget-"));
  runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;motivation=attacking",
    "--budget-tokens", "1000",
    "--run-id", "run_cost_show_budget",
    "--created-at", "2026-04-22T00:00:00.000Z",
  ], { cwd: workDir });
  const result = runCliOk(["show", "--run-id", "run_cost_show_budget"], { cwd: workDir });
  const lines = result.stdout.trim().split("\n");
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));
  const payload = JSON.parse(jsonLine);
  assert.equal(payload.ok, true);
  assert.ok(payload.budgetSpend, "show must include budgetSpend when create wrote a receipt");
  assert.ok(Number.isFinite(payload.budgetSpend.totalCost));
});

test("ak show with no budget artifacts omits cost and budgetSpend", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-cost-show-none-"));
  runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1",
    "--run-id", "run_cost_show_none",
    "--created-at", "2026-04-22T00:00:00.000Z",
  ], { cwd: workDir });
  const result = runCliOk(["show", "--run-id", "run_cost_show_none"], { cwd: workDir });
  const lines = result.stdout.trim().split("\n");
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));
  const payload = JSON.parse(jsonLine);
  assert.equal(payload.cost, undefined);
  assert.equal(payload.budgetSpend, undefined);
});

test("ak runs list entries include budgetSpend for budgeted runs", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-cost-runs-list-"));
  runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;motivation=attacking",
    "--budget-tokens", "1000",
    "--run-id", "run_cost_runs_list",
    "--created-at", "2026-04-22T00:00:00.000Z",
  ], { cwd: workDir });
  const result = runCliOk(["runs", "list"], { cwd: workDir });
  const payload = parseStdout(result);
  const entry = payload.runs.find((run) => run.runId === "run_cost_runs_list");
  assert.ok(entry, "runs list must include the budgeted run");
  const createCommand = entry.commands.find((command) => command.command === "create");
  assert.ok(createCommand?.budgetSpend, "create command entry must include budgetSpend");
});

test("ak create --dry-run with --budget-tokens estimates cost without writing paths", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-cost-dry-run-"));
  const result = runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;motivation=attacking",
    "--budget-tokens", "1000",
    "--dry-run",
    "--run-id", "run_cost_dry_run",
    "--created-at", "2026-04-22T00:00:00.000Z",
    "--out-dir", outDir,
  ]);
  const summary = parseStdout(result);
  assert.ok(summary.budgetEstimate, "dry-run must include budgetEstimate");
  assert.ok(Number.isFinite(summary.budgetEstimate.total) || Number.isFinite(summary.budgetEstimate.used));
  assert.equal(existsSync(join(outDir, "sim-config.json")), false);
  assert.equal(existsSync(join(outDir, "budget-receipt.json")), false);
});

test("cost.status is approved when totalSpend is within budget and all lines are approved", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-cost-status-approved-"));
  const result = runCliOk([
    "create",
    "--room", "size=small;count=1",
    "--delver", "count=1;motivation=attacking",
    "--text", "Cost status approved",
    "--budget-tokens", "1000",
    "--run-id", "run_cost_status_approved",
    "--created-at", "2026-04-22T00:00:00.000Z",
    "--out-dir", outDir,
  ]);
  const summary = parseStdout(result);
  assert.equal(summary.cost.status, "approved");
});

test.skip("cost.status is partial when some line items are denied", () => {});
