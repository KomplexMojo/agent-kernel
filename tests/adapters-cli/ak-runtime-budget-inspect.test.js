const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const RUNTIME_RECEIPT_SCHEMA = "agent-kernel/RuntimeBudgetReceiptArtifact";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return JSON.parse(result.stdout.trim());
}

function makeSimConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "sim_runtime_budget", runId: "run_runtime_budget", createdAt: "2026-09-02T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 1,
        height: 1,
        tiles: ["S"],
        spawn: { x: 0, y: 0 },
        rooms: [{ id: "R1", x: 0, y: 0, width: 1, height: 1 }],
      },
    },
  };
}

function makeInitialState() {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: { id: "state_runtime_budget", runId: "run_runtime_budget", createdAt: "2026-09-02T00:00:00.000Z" },
    simConfigRef: { id: "sim_runtime_budget", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
    actors: [{ id: "delver", kind: "stationary" }],
  };
}

test("inspect displays provided runtimeBudgetUnits values without reconstructing totals", () => {
  const runDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runtime-budget-inspect-"));
  const inspectDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runtime-budget-inspect-out-"));
  writeJson(join(runDir, "tick-frames.json"), [{ meta: { runId: "run_runtime_budget" }, tick: 1, phase: "execute" }]);
  writeJson(join(runDir, "effects-log.json"), []);
  const receipt = {
    schema: RUNTIME_RECEIPT_SCHEMA,
    schemaVersion: 1,
    meta: { id: "receipt_runtime_budget", runId: "run_runtime_budget", createdAt: "2026-09-02T00:00:00.000Z", producedBy: "allocator" },
    unit: "runtimeBudgetUnits",
    enforcement: "descriptive",
    rows: [{ actorId: "delver", tick: 1, actionKind: "wait", outcome: "accepted", units: 1, source: "allocator_runtime_action_price_v1" }],
    actorTotals: [{ actorId: "delver", units: 40 }],
    unattributedUnits: 2,
    totalUnits: 42,
  };
  writeJson(join(runDir, "runtime-budget-receipt.json"), receipt);

  const output = runCli([
    "inspect",
    "--tick-frames", join(runDir, "tick-frames.json"),
    "--effects-log", join(runDir, "effects-log.json"),
    "--out-dir", inspectDir,
  ]);

  assert.deepEqual(output.runtimeBudget, {
    unit: "runtimeBudgetUnits",
    rows: receipt.rows,
    actorTotals: receipt.actorTotals,
    unattributedUnits: 2,
    totalUnits: 42,
  });
  assert.equal(output.artifactPaths.runtime_budget_receipt, join(runDir, "runtime-budget-receipt.json"));
});

test("post-run GameplayBundle carries the exact persisted runtime receipt", () => {
  const createDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runtime-budget-bundle-"));
  const runDir = join(createDir, "run");
  const simConfig = makeSimConfig();
  const initialState = makeInitialState();
  writeJson(join(createDir, "sim-config.json"), simConfig);
  writeJson(join(createDir, "initial-state.json"), initialState);
  writeJson(join(createDir, "bundle.json"), { spec: { id: "preview" }, schemas: [], artifacts: [simConfig, initialState] });

  const output = runCli([
    "run",
    "--sim-config", join(createDir, "sim-config.json"),
    "--initial-state", join(createDir, "initial-state.json"),
    "--ticks", "0",
    "--out-dir", runDir,
  ]);

  const receipt = readJson(join(runDir, "runtime-budget-receipt.json"));
  const bundle = readJson(output.artifactPaths.bundle);
  assert.deepEqual(
    bundle.artifacts.find((artifact) => artifact?.schema === RUNTIME_RECEIPT_SCHEMA),
    receipt,
  );
});

test("runs list indexes the persisted runtime receipt as a run output", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runtime-budget-index-"));
  const runOutDir = join(workDir, "artifacts", "runs", "run_runtime_budget", "run");
  writeJson(join(runOutDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: { id: "runtime_summary", runId: "run_runtime_budget", createdAt: "2026-09-02T00:00:00.000Z", producedBy: "cli-run" },
  });
  writeJson(join(runOutDir, "runtime-budget-receipt.json"), {
    schema: RUNTIME_RECEIPT_SCHEMA,
    schemaVersion: 1,
    meta: { id: "receipt_runtime_budget", runId: "run_runtime_budget", createdAt: "2026-09-02T00:00:00.000Z", producedBy: "allocator" },
    unit: "runtimeBudgetUnits",
    rows: [],
    actorTotals: [],
    unattributedUnits: 0,
    totalUnits: 0,
  });

  const output = runCli(["runs", "list"], { cwd: workDir });
  const run = output.runs.find((entry) => entry.runId === "run_runtime_budget");
  assert.ok(run?.commands[0]?.outputs.some((entry) => entry.key === "runtime_budget_receipt"));
});

// ## TODO: Test Permutations
// - inspect without a sibling receipt omits runtimeBudget rather than fabricating zero values
// - a receipt with deliberately inconsistent row sums still displays its artifact-provided totals
// - a prior create bundle that already carries unrelated artifacts preserves both them and the receipt
