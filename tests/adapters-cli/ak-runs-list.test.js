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

// ## TODO: Test Permutations
// - Permutation: runs list when artifacts/runs/ exists but is empty — confirm ok:true with runs:[].
// - Permutation: runs list when one run directory has no command subfolders — confirm the run is
//   surfaced with commandCount:0 and a stable status field instead of being hidden.
// - Permutation: runs list when a command's spec/bundle is malformed JSON — confirm one run errors
//   without aborting the whole listing.
// - Permutation: runs list ordering — confirm runs are sorted by createdAt or runId in a stable,
//   documented order.
// - Permutation: runs list against a custom --out-dir created via `create --out-dir` outside the
//   default path — encode GAP-1 boundary (these runs should not appear under artifacts/runs/).
