const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createMeta(runId, id) {
  return {
    id,
    runId,
    createdAt: "2026-01-01T00:00:00.000Z",
    producedBy: "test",
  };
}

function normalizePrivatePath(value) {
  return String(value).replace(/^\/private/, "");
}

test("cli show summarizes a prior run directory", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-show-"));
  const runId = "run_show_basic";
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir = join(workDir, "artifacts", "runs", runId, "run");
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: createMeta(runId, "sim_config"),
    layout: {
      kind: "grid",
      data: {
        rooms: [{ id: "room_alpha" }, { id: "room_beta" }],
      },
    },
  });

  writeJson(join(buildDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: createMeta(runId, "initial_state"),
    actors: [
      { id: "actor_alpha", kind: "motivated" },
      { id: "actor_beta", kind: "stationary" },
    ],
  });

  writeJson(join(buildDir, "budget-receipt.json"), {
    schema: "agent-kernel/BudgetReceiptArtifact",
    schemaVersion: 1,
    meta: createMeta(runId, "budget_receipt"),
    budgetRef: { id: "budget", schema: "agent-kernel/BudgetArtifact", schemaVersion: 1 },
    priceListRef: { id: "price_list", schema: "agent-kernel/PriceList", schemaVersion: 1 },
    status: "approved",
    totalCost: 42,
    remaining: 58,
    lineItems: [],
    scenarioSpendReport: {
      budget: 100,
      totalSpend: 42,
      remainingBudget: 58,
      overBudget: false,
      categories: {
        rooms: { actual: 20, target: 55, usagePercent: 36 },
        delvers: { actual: 10, target: 20, usagePercent: 50 },
        wardens: { actual: 12, target: 25, usagePercent: 48 },
      },
      totalBudgetUsagePercent: 42,
      incentive: {
        actualRatio: 0.833,
        targetRatio: 0.8,
        mismatch: 0.033,
        multiplier: 0.959,
      },
    },
  });

  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: createMeta(runId, "run_summary"),
    outcome: "success",
    metrics: { ticks: 3 },
  });

  const result = runCli(["show", "--run-id", runId], { cwd: workDir });
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "show");
  assert.equal(output.runId, runId);
  assert.equal(output.commandCount, 2);
  assert.equal(output.status, "success");
  assert.deepEqual(output.actorIds, ["actor_alpha", "actor_beta"]);
  assert.deepEqual(output.roomIds, ["room_alpha", "room_beta"]);
  assert.equal(output.actorCount, 2);
  assert.equal(output.roomCount, 2);
  assert.equal(output.budgetSpend.totalCost, 42);
  assert.equal(output.budgetSpend.remaining, 58);
  assert.equal(output.budgetSpend.scenarioSpendReport.totalSpend, 42);
  assert.deepEqual(
    output.artifactPaths.map(normalizePrivatePath),
    [
      join(buildDir, "budget-receipt.json"),
      join(buildDir, "initial-state.json"),
      join(buildDir, "sim-config.json"),
      join(runDir, "run-summary.json"),
    ].map(normalizePrivatePath),
  );
  assert.equal(output.commands[0].command, "build");
  assert.equal(output.commands[0].budgetSpend.totalCost, 42);
  assert.equal(output.commands[1].command, "run");
  assert.equal(output.commands[1].ticks, 3);
});

test("cli show returns structured failure for unknown runs", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-show-missing-"));
  const result = runCli(["show", "--run-id", "run_missing"], { cwd: workDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Run directory not found:/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "show");
  assert.match(output.error, /Run directory not found:/);
});
