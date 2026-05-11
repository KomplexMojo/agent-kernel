'use strict';

// M1 — CLI tests for the --visualization flag on tick commands.
//
// All tests exercising --visualization FAIL until M3 (ascii) and M4 (image)
// implement the flag. The backward-compat test passes immediately to confirm
// no regression on existing tick state behaviour.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join, dirname } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeMeta(id, runId) {
  return { id, runId, createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" };
}

function scaffoldRun(workDir, runId, { maxTick = 5 } = {}) {
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir  = join(workDir, "artifacts", "runs", runId, "run");

  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: makeMeta("sim_config", runId),
    layout: {
      kind: "grid",
      width: 7,
      height: 3,
      data: {
        width: 7,
        height: 3,
        tiles: ["#######", "#.....#", "#######"],
        legend: { "#": { tile: "wall" }, ".": { tile: "floor" } },
      },
    },
    traps: [
      { id: "trap_1", x: 2, y: 1, affinity: "fire", expression: "emit", stacks: 3, blocking: false },
    ],
    resources: [
      { id: "resource_1", x: 4, y: 1, tier: "level", stat: "vitalMax", delta: 10, dropRate: 50 },
    ],
  });

  writeJson(join(buildDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: makeMeta("initial_state", runId),
    actors: [
      {
        id: "actor_delver_1",
        kind: "motivated",
        role: "delver",
        position: { x: 1, y: 1 },
        affinity: "fire",
        motivation: "exploring",
        affinities: [{ name: "fire", stacks: 2, expression: "emit" }],
        vitals: { health: { current: 10, max: 10, regen: 1 }, stamina: { current: 7, max: 7, regen: 1 } },
      },
      {
        id: "actor_warden_1",
        kind: "motivated",
        role: "warden",
        position: { x: 5, y: 1 },
        affinity: "dark",
        motivation: "stationary",
        affinities: [{ name: "dark", stacks: 1, expression: "emit" }],
        vitals: { health: { current: 15, max: 15, regen: 0 }, stamina: { current: 5, max: 5, regen: 0 } },
      },
    ],
  });

  const frames = Array.from({ length: maxTick }, (_, i) => ({
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: makeMeta(`tf_${i + 1}`, runId),
    tick: i + 1,
    phase: "summarize",
    acceptedActions: [
      {
        schema: "agent-kernel/Action",
        schemaVersion: 1,
        actorId: "actor_delver_1",
        tick: i + 1,
        kind: "wait",
        params: { reason: "idle" },
      },
    ],
  }));
  writeJson(join(runDir, "tick-frames.json"), frames);
  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: makeMeta("run_summary", runId),
    outcome: "success",
    metrics: { ticks: maxTick },
  });
}

// ---------------------------------------------------------------------------
// Backward compat — PASSES immediately (no visualization flag, existing fields)
// ---------------------------------------------------------------------------

test("tick state without --visualization preserves existing ascii + tickFrame fields", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-viz-compat-"));
  const runId = "run_viz_compat";
  scaffoldRun(workDir, runId, { maxTick: 3 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.tick, 1);
  assert.equal(typeof output.ascii, "string", "ascii field must still be present");
  assert.ok(output.tickFrame !== undefined, "tickFrame field must still be present");
  assert.equal(output.visualization, undefined, "visualization must be absent without the flag");
});

// ---------------------------------------------------------------------------
// FAILING: --visualization ascii not yet implemented (M3)
// ---------------------------------------------------------------------------

test("tick state --visualization ascii returns visualization object with ascii mode", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-viz-ascii-"));
  const runId = "run_viz_ascii";
  scaffoldRun(workDir, runId, { maxTick: 3 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  const result = runCli(["tick", "state", "--run-id", runId, "--visualization", "ascii"], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  // FAILS: visualization field not present until M3
  assert.ok(output.visualization !== undefined, "visualization field must be present with --visualization ascii");
  assert.equal(output.visualization.mode, "ascii");
  assert.equal(typeof output.visualization.ascii, "string");
  assert.ok(output.visualization.layers, "layers must be present in ascii mode");
  assert.equal(typeof output.visualization.layers.layout, "string");
  assert.equal(typeof output.visualization.layers.hazards, "string");
  assert.equal(typeof output.visualization.layers.resources, "string");
  assert.equal(typeof output.visualization.layers.delvers, "string");
  assert.equal(typeof output.visualization.layers.wardens, "string");
  assert.ok(Array.isArray(output.visualization.actorDetails));
});

test("tick state --visualization ascii actorDetails includes affinities vitals and motivation", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-viz-detail-"));
  const runId = "run_viz_detail";
  scaffoldRun(workDir, runId, { maxTick: 3 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  const result = runCli(["tick", "state", "--run-id", runId, "--visualization", "ascii"], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  // FAILS until M3
  assert.ok(Array.isArray(output.visualization?.actorDetails) && output.visualization.actorDetails.length >= 1,
    "actorDetails must contain at least one actor");
  const delver = output.visualization.actorDetails.find((a) => a.id === "actor_delver_1");
  assert.ok(delver, "actor_delver_1 must be in actorDetails");
  assert.equal(delver.motivation, "exploring");
  assert.ok(Array.isArray(delver.affinities) && delver.affinities.length > 0);
  assert.ok(delver.vitals?.health, "health vital must be present");
});

test("tick forward --visualization ascii includes visualization at the new tick", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-viz-fwd-"));
  const runId = "run_viz_fwd";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  const result = runCli(["tick", "forward", "--run-id", runId, "--visualization", "ascii"], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.tick, 1);
  // FAILS until M3
  assert.ok(output.visualization !== undefined, "tick forward must include visualization when flag is present");
  assert.equal(output.visualization.mode, "ascii");
  assert.equal(output.visualization.tick, 1, "visualization.tick must match the cursor tick after forward");
});

test("tick backward --visualization ascii includes visualization at the rewound tick", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-viz-bwd-"));
  const runId = "run_viz_bwd";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);
  const result = runCli(["tick", "backward", "--run-id", runId, "--visualization", "ascii"], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.tick, 1);
  // FAILS until M3
  assert.ok(output.visualization !== undefined, "tick backward must include visualization when flag is present");
  assert.equal(output.visualization.tick, 1, "visualization.tick must match the cursor tick after backward");
});

// ---------------------------------------------------------------------------
// FAILING: --visualization image not yet implemented (M4)
// ---------------------------------------------------------------------------

test("tick state --visualization image returns visualizationDataUri as PNG data URI", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-viz-img-"));
  const runId = "run_viz_img";
  scaffoldRun(workDir, runId, { maxTick: 3 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  const result = runCli(["tick", "state", "--run-id", runId, "--visualization", "image"], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  // FAILS until M4
  assert.ok(output.visualization !== undefined, "visualization must be present with --visualization image");
  assert.equal(output.visualization.mode, "image");
  assert.ok(typeof output.visualization.visualizationDataUri === "string" &&
    output.visualization.visualizationDataUri.startsWith("data:image/png;base64,"),
    "visualizationDataUri must be a PNG data URI");
  const base64 = output.visualization.visualizationDataUri.replace("data:image/png;base64,", "");
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes[0], 0x89, "PNG magic byte 0 must be 0x89");
  assert.equal(bytes[1], 0x50, "PNG magic byte 1 must be 0x50 (P)");
  assert.equal(bytes[2], 0x4e, "PNG magic byte 2 must be 0x4e (N)");
  assert.equal(bytes[3], 0x47, "PNG magic byte 3 must be 0x47 (G)");
});

test("tick state --visualization with invalid value returns ok:false with structured error", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-viz-bad-"));
  const runId = "run_viz_bad";
  scaffoldRun(workDir, runId, { maxTick: 3 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  const result = runCli(["tick", "state", "--run-id", runId, "--visualization", "video"], workDir);
  // FAILS until M3 validates the flag value
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.match(output.error, /ascii|image|visualization/i,
    "error must name the valid visualization values");
});

/*
## TODO: Test Permutations
- tick state --visualization ascii at tick 0 (no prior forward) returns ok:true with null/empty visualization
- tick state --visualization ascii when WASM binary is absent returns ok:true with ascii null or empty
- tick state --visualization image when WASM binary is absent returns ok:true with visualizationDataUri null
- tick forward at maxTick boundary with --visualization ascii still returns ok:false boundary error
- tick backward at tick 0 with --visualization ascii still returns ok:false boundary error
- tick state --visualization ascii with missing initial-state.json returns ok:true with best-effort ascii
- tick state --visualization image at tick 0 returns visualizationDataUri null
- consecutive tick forward calls each returning --visualization ascii produce distinct delver positions
*/
