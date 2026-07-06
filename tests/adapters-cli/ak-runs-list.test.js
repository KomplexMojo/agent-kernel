const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join, dirname } = require("node:path");
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
  return JSON.parse(result.stdout.trim());
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("cli runs list indexes run-scoped command outputs", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runs-list-"));
  const buildOutDir = join(workDir, "artifacts", "runs", "run_alpha", "build");
  const runOutDir = join(workDir, "artifacts", "runs", "run_alpha", "run");
  const createOutDir = join(workDir, "artifacts", "runs", "run_beta", "create");

  writeJson(join(buildOutDir, "spec.json"), {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "spec_alpha",
      runId: "run_alpha",
      createdAt: "2026-04-08T00:00:00.000Z",
      producedBy: "fixture",
      source: "cli-build",
    },
  });
  writeJson(join(buildOutDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "sim_alpha",
      runId: "run_alpha",
      createdAt: "2026-04-08T00:00:00.000Z",
      producedBy: "fixture",
    },
    layout: {
      data: {
        rooms: [{ id: "room_alpha" }],
      },
    },
  });
  writeJson(join(buildOutDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "initial_alpha",
      runId: "run_alpha",
      createdAt: "2026-04-08T00:00:00.000Z",
      producedBy: "fixture",
    },
    actors: [{ id: "delver_alpha" }],
  });
  writeJson(join(buildOutDir, "bundle.json"), {
    spec: { meta: { runId: "run_alpha" } },
    artifacts: [],
  });
  writeJson(join(buildOutDir, "manifest.json"), {
    correlation: { runId: "run_alpha", source: "cli-build" },
    artifacts: [],
  });
  writeJson(join(buildOutDir, "telemetry.json"), {
    schema: "agent-kernel/TelemetryRecord",
    schemaVersion: 1,
    meta: {
      id: "telemetry_alpha",
      runId: "run_alpha",
      createdAt: "2026-04-08T00:00:00.000Z",
      producedBy: "cli-build",
    },
    data: {
      status: "success",
      source: "cli-build",
    },
  });

  writeJson(join(runOutDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "run_sim_alpha",
      runId: "run_alpha",
      createdAt: "2026-04-09T00:00:00.000Z",
      producedBy: "fixture",
    },
    layout: {
      data: {
        rooms: [{ id: "room_runtime" }],
      },
    },
  });
  writeJson(join(runOutDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "run_initial_alpha",
      runId: "run_alpha",
      createdAt: "2026-04-09T00:00:00.000Z",
      producedBy: "fixture",
    },
    actors: [{ id: "warden_runtime" }],
  });
  writeJson(join(runOutDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: {
      id: "run_summary_alpha",
      runId: "run_alpha",
      createdAt: "2026-04-09T00:00:00.000Z",
      producedBy: "cli-run",
    },
    outcome: "unknown",
    metrics: {
      ticks: 3,
    },
  });
  writeJson(join(runOutDir, "tick-frames.json"), []);
  writeJson(join(runOutDir, "effects-log.json"), []);

  writeJson(join(createOutDir, "request.json"), {
    schema: "agent-kernel/AgentCommandRequestArtifact",
    schemaVersion: 1,
    meta: {
      id: "request_beta",
      runId: "run_beta",
      createdAt: "2026-04-10T00:00:00.000Z",
      producedBy: "cli-create",
    },
  });
  writeJson(join(createOutDir, "spec.json"), {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "spec_beta",
      runId: "run_beta",
      createdAt: "2026-04-10T00:00:00.000Z",
      producedBy: "fixture",
      source: "cli-create",
    },
  });
  writeJson(join(createOutDir, "bundle.json"), {
    spec: { meta: { runId: "run_beta" } },
    artifacts: [],
  });

  const result = runCli(["runs", "list"], { cwd: workDir });
  assert.equal(result.ok, true);
  assert.equal(result.command, "runs");
  assert.equal(result.action, "list");
  assert.equal(result.runs.length, 2);

  const alpha = result.runs.find((entry) => entry.runId === "run_alpha");
  assert.equal(alpha.status, "success");
  assert.equal(alpha.commandCount, 2);
  assert.deepEqual(alpha.commands.map((entry) => entry.command), ["run", "build"]);

  const alphaRun = alpha.commands.find((entry) => entry.command === "run");
  assert.equal(alphaRun.status, "success");
  assert.equal(alphaRun.ticks, 3);
  assert.deepEqual(alphaRun.actorIds, ["warden_runtime"]);
  assert.deepEqual(alphaRun.roomIds, ["room_runtime"]);
  assert.ok(alphaRun.outputs.some((entry) => entry.key === "run_summary"));
  assert.ok(alphaRun.outputs.some((entry) => entry.key === "tick_frames"));

  const alphaBuild = alpha.commands.find((entry) => entry.command === "build");
  assert.equal(alphaBuild.source, "cli-build");
  assert.deepEqual(alphaBuild.actorIds, ["delver_alpha"]);
  assert.deepEqual(alphaBuild.roomIds, ["room_alpha"]);
  assert.ok(alphaBuild.inputs.some((entry) => entry.key === "spec"));
  assert.ok(alphaBuild.outputs.some((entry) => entry.key === "telemetry"));

  const beta = result.runs.find((entry) => entry.runId === "run_beta");
  assert.equal(beta.status, "success");
  assert.equal(beta.commandCount, 1);
  assert.equal(beta.commands[0].command, "create");
  assert.equal(beta.commands[0].source, "cli-create");
  assert.ok(beta.commands[0].inputs.some((entry) => entry.key === "request"));
  assert.ok(beta.commands[0].outputs.some((entry) => entry.key === "bundle"));
});

test("cli runs list returns an empty index when artifacts/runs is missing", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runs-empty-"));
  const result = runCli(["runs", "list"], { cwd: workDir });
  assert.equal(result.ok, true);
  assert.equal(result.command, "runs");
  assert.deepEqual(result.runs, []);
});

test("cli runs list returns empty runs when artifacts/runs exists but is empty", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runs-empty-dir-"));
  mkdirSync(join(workDir, "artifacts", "runs"), { recursive: true });

  const result = runCli(["runs", "list"], { cwd: workDir });

  assert.equal(result.ok, true);
  assert.deepEqual(result.runs, []);
});

test("cli runs list surfaces a run directory with no command subfolders", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runs-no-commands-"));
  mkdirSync(join(workDir, "artifacts", "runs", "run_empty"), { recursive: true });

  const result = runCli(["runs", "list"], { cwd: workDir });
  const run = result.runs.find((entry) => entry.runId === "run_empty");

  assert.ok(run);
  assert.equal(run.commandCount, 0);
  assert.ok(typeof run.status === "string");
});

test.skip("cli runs list reports malformed command artifacts without aborting the listing by documented GAP", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runs-malformed-"));
  const malformedSpec = join(workDir, "artifacts", "runs", "run_bad", "build", "spec.json");
  mkdirSync(dirname(malformedSpec), { recursive: true });
  writeFileSync(malformedSpec, "{bad json", "utf8");
  writeJson(join(workDir, "artifacts", "runs", "run_ok", "build", "spec.json"), {
    schema: "agent-kernel/BuildSpec",
    meta: { id: "spec_ok", runId: "run_ok", createdAt: "2026-04-08T00:00:00.000Z" },
  });

  const result = runCli(["runs", "list"], { cwd: workDir });

  assert.equal(result.ok, true);
  assert.ok(result.runs.some((entry) => entry.runId === "run_ok"));
  assert.ok(result.runs.some((entry) => entry.runId === "run_bad"));
});

test("cli runs list ordering is stable across repeated calls", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-runs-order-"));
  ["run_c", "run_a", "run_b"].forEach((runId) => {
    writeJson(join(workDir, "artifacts", "runs", runId, "build", "spec.json"), {
      schema: "agent-kernel/BuildSpec",
      meta: { id: `spec_${runId}`, runId, createdAt: "2026-04-08T00:00:00.000Z" },
    });
  });

  const first = runCli(["runs", "list"], { cwd: workDir }).runs.map((entry) => entry.runId);
  const second = runCli(["runs", "list"], { cwd: workDir }).runs.map((entry) => entry.runId);

  assert.deepEqual(first, second);
});

test.skip("runs list excludes custom --out-dir runs outside artifacts/runs by documented GAP-1 boundary", () => {});
