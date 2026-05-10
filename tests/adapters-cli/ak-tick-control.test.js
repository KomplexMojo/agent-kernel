'use strict';

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve, join, dirname } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const testIfWasm = existsSync(WASM_PATH) ? test : test.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeMeta(id, runId) {
  return { id, runId, createdAt: "2026-01-01T00:00:00.000Z", producedBy: "fixture" };
}

function makeTickFrame(tick, runId) {
  return {
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: makeMeta(`tick_frame_${tick}`, runId),
    tick,
    phase: "execute",
    acceptedActions: [
      {
        schema: "agent-kernel/Action",
        schemaVersion: 1,
        actorId: "actor_delver",
        tick,
        kind: "wait",
        params: { reason: "idle" },
      },
    ],
  };
}

function scaffoldRun(workDir, runId, { maxTick = 10 } = {}) {
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir = join(workDir, "artifacts", "runs", runId, "run");

  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: makeMeta("sim_config", runId),
    layout: {
      kind: "grid",
      width: 5,
      height: 5,
      data: {
        width: 5,
        height: 5,
        tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
        legend: { "#": { tile: "wall" }, ".": { tile: "floor" } },
      },
    },
  });

  writeJson(join(buildDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: makeMeta("initial_state", runId),
    actors: [
      { id: "actor_delver", kind: "motivated", position: { x: 1, y: 1 } },
    ],
  });

  const frames = Array.from({ length: maxTick }, (_, i) => makeTickFrame(i + 1, runId));
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
// tick forward — initializes cursor and advances
// ---------------------------------------------------------------------------

test("cli tick forward initializes cursor at tick 0 and advances to tick 1", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-fwd-init-"));
  const runId = "run_tick_fwd_init";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  const result = runCli(["tick", "forward", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "tick");
  assert.equal(output.action, "forward");
  assert.equal(output.runId, runId);
  assert.equal(output.previousTick, 0);
  assert.equal(output.tick, 1);
  assert.equal(output.maxTick, 10);
});

test("cli tick forward advances an existing cursor from tick 1 to tick 2", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-fwd-step-"));
  const runId = "run_tick_fwd_step";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  // First advance creates cursor at tick 1
  runCli(["tick", "forward", "--run-id", runId], workDir);

  // Second advance should move to tick 2
  const result = runCli(["tick", "forward", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.previousTick, 1);
  assert.equal(output.tick, 2);
  assert.equal(output.maxTick, 10);
});

test("cli tick forward persists the cursor artifact after advancing", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-fwd-persist-"));
  const runId = "run_tick_fwd_persist";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const cursorPath = join(workDir, "artifacts", "runs", runId, "session", "cursor.json");
  assert.ok(existsSync(cursorPath), "cursor.json must be written after tick forward");

  const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.equal(cursor.runId, runId);
  assert.equal(cursor.tick, 1);
  assert.equal(cursor.maxTick, 10);
});

// ---------------------------------------------------------------------------
// tick backward — rewinds
// ---------------------------------------------------------------------------

test("cli tick backward rewinds cursor from tick 2 to tick 1", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-bwd-"));
  const runId = "run_tick_bwd";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);

  const result = runCli(["tick", "backward", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "tick");
  assert.equal(output.action, "backward");
  assert.equal(output.runId, runId);
  assert.equal(output.previousTick, 2);
  assert.equal(output.tick, 1);
  assert.equal(output.maxTick, 10);
});

test("cli tick backward at tick 0 returns structured error without exiting 0", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-bwd-zero-"));
  const runId = "run_tick_bwd_zero";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  // No forward — cursor starts at tick 0
  const result = runCli(["tick", "backward", "--run-id", runId], workDir);
  assert.notEqual(result.status, 0);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "tick");
  assert.equal(output.action, "backward");
  assert.equal(output.runId, runId);
  assert.equal(output.tick, 0);
  assert.match(output.error, /tick 0|cannot rewind/i);
});

// ---------------------------------------------------------------------------
// tick forward at maxTick — boundary error
// ---------------------------------------------------------------------------

test("cli tick forward at maxTick 10 returns structured error", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-fwd-max-"));
  const runId = "run_tick_fwd_max";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  // Advance to tick 10
  for (let i = 0; i < 10; i++) {
    runCli(["tick", "forward", "--run-id", runId], workDir);
  }

  const result = runCli(["tick", "forward", "--run-id", runId], workDir);
  assert.notEqual(result.status, 0);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.tick, 10);
  assert.equal(output.maxTick, 10);
  assert.match(output.error, /max tick|cannot advance/i);
});

// ---------------------------------------------------------------------------
// tick state — ASCII visualization
// ---------------------------------------------------------------------------

test("cli tick state returns runId, tick, maxTick, and ascii field", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-state-"));
  const runId = "run_tick_state";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "tick");
  assert.equal(output.action, "state");
  assert.equal(output.runId, runId);
  assert.equal(output.tick, 1);
  assert.equal(output.maxTick, 10);
  assert.ok("ascii" in output, "response must include ascii field");
});

testIfWasm("cli tick state ascii is a non-empty grid string when WASM is present", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-state-wasm-"));
  const runId = "run_tick_state_wasm";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(typeof output.ascii, "string");
  assert.ok(output.ascii.length > 0, "ascii must not be empty");
  assert.ok(output.ascii.includes("\n"), "ascii must contain newline-separated rows");
});

// ---------------------------------------------------------------------------
// Errors — unknown run
// ---------------------------------------------------------------------------

test("cli tick forward returns structured error for unknown run", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-unknown-"));
  const result = runCli(["tick", "forward", "--run-id", "run_does_not_exist"], workDir);

  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "tick");
  assert.match(output.error, /run directory not found|not found/i);
});

// ---------------------------------------------------------------------------
// Rewind parity — tick N after rewind == direct forward replay to tick N
// ---------------------------------------------------------------------------

test("cli tick state at tick 2 after rewind matches state reached by forward-only replay", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-parity-"));
  const runId = "run_tick_parity";
  scaffoldRun(workDir, runId, { maxTick: 10 });

  // Path A: forward x3, backward x1, state → tick 2
  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "backward", "--run-id", runId], workDir);
  const afterRewind = JSON.parse(
    runCli(["tick", "state", "--run-id", runId], workDir).stdout,
  );

  // Path B: fresh run, forward x2, state → tick 2
  const workDir2 = mkdtempSync(join(os.tmpdir(), "ak-tick-parity2-"));
  const runId2 = "run_tick_parity2";
  scaffoldRun(workDir2, runId2, { maxTick: 10 });
  runCli(["tick", "forward", "--run-id", runId2], workDir2);
  runCli(["tick", "forward", "--run-id", runId2], workDir2);
  const directForward = JSON.parse(
    runCli(["tick", "state", "--run-id", runId2], workDir2).stdout,
  );

  // Both must report tick 2
  assert.equal(afterRewind.tick, 2);
  assert.equal(directForward.tick, 2);
  // ASCII grids must be identical (same world state at same tick)
  assert.equal(afterRewind.ascii, directForward.ascii);
});

// ---------------------------------------------------------------------------
// Permutation: maxTick boundary at 1
// ---------------------------------------------------------------------------

test("cli tick forward on a run with maxTick 1 — first forward succeeds, second returns structured error", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-maxtick1-"));
  const runId = "run_tick_maxtick1";
  scaffoldRun(workDir, runId, { maxTick: 1 });

  const first = runCli(["tick", "forward", "--run-id", runId], workDir);
  assert.equal(first.status, 0, first.stderr);
  const out1 = JSON.parse(first.stdout);
  assert.equal(out1.ok, true);
  assert.equal(out1.tick, 1);

  const second = runCli(["tick", "forward", "--run-id", runId], workDir);
  assert.notEqual(second.status, 0);
  const out2 = JSON.parse(second.stdout);
  assert.equal(out2.ok, false);
  assert.match(out2.error, /max tick|cannot advance/i);
});

// ---------------------------------------------------------------------------
// Permutation: backward to tick 0 then error on second backward
// ---------------------------------------------------------------------------

test("cli tick backward from tick 1 to tick 0 succeeds; subsequent backward returns structured error", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-bwd-chain-"));
  const runId = "run_tick_bwd_chain";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const bwd1 = runCli(["tick", "backward", "--run-id", runId], workDir);
  assert.equal(bwd1.status, 0, bwd1.stderr);
  const out1 = JSON.parse(bwd1.stdout);
  assert.equal(out1.ok, true);
  assert.equal(out1.tick, 0);

  const bwd2 = runCli(["tick", "backward", "--run-id", runId], workDir);
  assert.notEqual(bwd2.status, 0);
  const out2 = JSON.parse(bwd2.stdout);
  assert.equal(out2.ok, false);
  assert.match(out2.error, /tick 0|cannot rewind/i);

  // Cursor must remain at tick 0 after the failed rewind
  const cursorPath = join(workDir, "artifacts", "runs", runId, "session", "cursor.json");
  const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.equal(cursor.tick, 0);
});

// ---------------------------------------------------------------------------
// Permutation: tick state at tick 0 (no forward yet)
// ---------------------------------------------------------------------------

test("cli tick state at tick 0 before any forward returns ok with tick:0 and null tickFrame", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-state-zero-"));
  const runId = "run_tick_state_zero";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.tick, 0);
  assert.equal(output.maxTick, 5);
  assert.equal(output.tickFrame, null, "tickFrame must be null at tick 0");
  assert.ok("ascii" in output, "ascii field must be present");
});

// ---------------------------------------------------------------------------
// Permutation: tick forward with no run data returns structured error
// ---------------------------------------------------------------------------

test("cli tick forward when tick-frames.json and run-summary.json are both absent returns structured error", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-fwd-noframes-"));
  const runId = "run_tick_fwd_noframes";

  // Only write build/sim-config.json — no run dir at all
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1,
    meta: makeMeta("sim_config", runId),
    layout: { kind: "grid", width: 5, height: 5,
      data: { width: 5, height: 5, tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
        legend: { "#": { tile: "wall" }, ".": { tile: "floor" } } } },
  });

  const result = runCli(["tick", "forward", "--run-id", runId], workDir);
  assert.notEqual(result.status, 0, "tick forward must fail when no tick data exists");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "tick");
  assert.match(output.error, /not found|missing/i);
});

// ---------------------------------------------------------------------------
// Permutation: maxTick inferred from tick-frames.json length when run-summary absent
// ---------------------------------------------------------------------------

test("cli tick forward uses tick-frames.json length as maxTick when run-summary.json is absent", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-tick-fwd-nosummary-"));
  const runId = "run_tick_fwd_nosummary";
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir = join(workDir, "artifacts", "runs", runId, "run");

  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1,
    meta: makeMeta("sim_config", runId),
    layout: { kind: "grid", width: 5, height: 5,
      data: { width: 5, height: 5, tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
        legend: { "#": { tile: "wall" }, ".": { tile: "floor" } } } },
  });
  writeJson(join(buildDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1,
    meta: makeMeta("initial_state", runId),
    actors: [{ id: "actor_delver", kind: "motivated", position: { x: 1, y: 1 } }],
  });
  // 4 frames, no run-summary.json → readMaxTick falls back to frames.length
  const frames = Array.from({ length: 4 }, (_, i) => makeTickFrame(i + 1, runId));
  writeJson(join(runDir, "tick-frames.json"), frames);

  const result = runCli(["tick", "forward", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.maxTick, 4, "maxTick must be inferred from tick-frames.json length");
  assert.equal(output.tick, 1);
});
