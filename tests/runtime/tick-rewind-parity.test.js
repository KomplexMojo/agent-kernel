'use strict';

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
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
        kind: tick % 2 === 0 ? "wait" : "move",
        params: tick % 2 === 0
          ? { reason: "idle" }
          : { direction: "east", from: { x: tick, y: 1 }, to: { x: tick + 1, y: 1 } },
      },
    ],
  };
}

function scaffoldRun(workDir, runId, { maxTick = 5 } = {}) {
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir = join(workDir, "artifacts", "runs", runId, "run");

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
// Cursor invariants
// ---------------------------------------------------------------------------

test("cursor schema and meta fields are complete after tick forward", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-schema-"));
  const runId = "run_rp_schema";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const cursorPath = join(workDir, "artifacts", "runs", runId, "session", "cursor.json");
  assert.ok(existsSync(cursorPath), "cursor.json must exist after tick forward");

  const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.equal(cursor.schema, "agent-kernel/TickCursor");
  assert.equal(cursor.schemaVersion, 1);
  assert.ok(cursor.meta, "cursor.meta must be present");
  assert.equal(cursor.meta.runId, runId);
  assert.ok(typeof cursor.meta.createdAt === "string", "meta.createdAt must be an ISO string");
  assert.equal(cursor.runId, runId);
  assert.equal(cursor.tick, 1);
  assert.equal(cursor.maxTick, 5);
});

test("cursor maxTick is unchanged by rewind", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-maxtick-"));
  const runId = "run_rp_maxtick";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "backward", "--run-id", runId], workDir);

  const cursorPath = join(workDir, "artifacts", "runs", runId, "session", "cursor.json");
  const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.equal(cursor.tick, 1, "cursor.tick must be 1 after forward×2 then backward×1");
  assert.equal(cursor.maxTick, 5, "maxTick must be unchanged by rewind");
});

test("forward after rewind lands at the same tick as direct forward", () => {
  // Path A: forward×3, backward×1, forward×1 → tick 3
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-path-"));
  const runId = "run_rp_path";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "backward", "--run-id", runId], workDir);
  const pathA = JSON.parse(runCli(["tick", "forward", "--run-id", runId], workDir).stdout);

  // Path B: direct forward×3 in a fresh run → tick 3
  const workDir2 = mkdtempSync(join(os.tmpdir(), "ak-rp-path2-"));
  const runId2 = "run_rp_path2";
  scaffoldRun(workDir2, runId2, { maxTick: 5 });
  runCli(["tick", "forward", "--run-id", runId2], workDir2);
  runCli(["tick", "forward", "--run-id", runId2], workDir2);
  const pathB = JSON.parse(runCli(["tick", "forward", "--run-id", runId2], workDir2).stdout);

  assert.equal(pathA.tick, 3, "path A must land at tick 3");
  assert.equal(pathB.tick, 3, "path B must land at tick 3");
  assert.equal(pathA.maxTick, pathB.maxTick, "maxTick must be identical across navigation paths");
});

// ---------------------------------------------------------------------------
// FAILING: tick state must expose the TickFrame at the cursor tick
// ---------------------------------------------------------------------------

// FAILING: tick state currently returns { ok, command, action, runId, tick, maxTick, ascii }.
// M4 will add tickFrame: <the TickFrame at cursor tick> so agents can read accepted actions,
// actor positions, and events at any tick without parsing tick-frames.json directly.
test("tick state response includes tickFrame data at cursor tick", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-frame-"));
  const runId = "run_rp_frame";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.ok(output.ok, "tick state must succeed");
  assert.equal(output.tick, 1, "cursor tick must be 1 after one forward");

  // FAILS: tickFrame field is not yet included in tick state output
  assert.ok(output.tickFrame !== undefined, "tick state must include tickFrame at cursor tick");
  assert.equal(output.tickFrame.tick, 1, "tickFrame.tick must match cursor tick");
  assert.ok(Array.isArray(output.tickFrame.acceptedActions), "tickFrame must include acceptedActions");
});

// ---------------------------------------------------------------------------
// Permutation: consecutive rewinds from maxTick to tick 0
// ---------------------------------------------------------------------------

test("consecutive rewinds from maxTick to tick 0 each succeed and decrement cursor", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-consec-bwd-"));
  const runId = "run_rp_consec";
  const maxTick = 3;
  scaffoldRun(workDir, runId, { maxTick });

  // Advance to maxTick first
  for (let i = 0; i < maxTick; i++) {
    runCli(["tick", "forward", "--run-id", runId], workDir);
  }

  // Rewind all the way back; each backward must succeed and decrement by 1
  for (let expected = maxTick - 1; expected >= 0; expected--) {
    const result = runCli(["tick", "backward", "--run-id", runId], workDir);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true, `backward to tick ${expected} must succeed`);
    assert.equal(output.tick, expected, `cursor must decrement to ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// Permutation: tickFrame at tick 0 (no forward yet) returns null
// ---------------------------------------------------------------------------

test("tick state at tick 0 before any forward has null tickFrame", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-tick0-frame-"));
  const runId = "run_rp_zero";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.tick, 0);
  assert.equal(output.tickFrame, null, "tickFrame must be null at tick 0");
});

// ---------------------------------------------------------------------------
// Permutation: tickFrame.acceptedActions match scaffold fixture at tick 2 (even → wait)
// ---------------------------------------------------------------------------

test("tickFrame.acceptedActions match scaffold fixture data at tick 2", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-actions-"));
  const runId = "run_rp_tick2";
  scaffoldRun(workDir, runId, { maxTick: 5 });

  runCli(["tick", "forward", "--run-id", runId], workDir);
  runCli(["tick", "forward", "--run-id", runId], workDir);

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.tick, 2);
  assert.ok(output.tickFrame, "tickFrame must be present at tick 2");
  assert.ok(Array.isArray(output.tickFrame.acceptedActions));
  // tick 2 is even → scaffold makeTickFrame produces kind: "wait"
  assert.equal(output.tickFrame.acceptedActions[0].kind, "wait");
  assert.equal(output.tickFrame.acceptedActions[0].actorId, "actor_delver");
});

// ---------------------------------------------------------------------------
// Permutation: tickFrame at maxTick is present and within bounds
// ---------------------------------------------------------------------------

test("tickFrame at maxTick is present and tickFrame.tick equals maxTick", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-maxtick-bound-"));
  const runId = "run_rp_max";
  const maxTick = 4;
  scaffoldRun(workDir, runId, { maxTick });

  for (let i = 0; i < maxTick; i++) {
    runCli(["tick", "forward", "--run-id", runId], workDir);
  }

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.tick, maxTick);
  assert.ok(output.tickFrame !== undefined, "tickFrame must be present at maxTick");
  assert.equal(output.tickFrame.tick, maxTick, "tickFrame.tick must equal maxTick");
  assert.ok(Array.isArray(output.tickFrame.acceptedActions));
});

// ---------------------------------------------------------------------------
// Permutation: tick state with missing tick-frames.json returns gracefully
// ---------------------------------------------------------------------------

test("tick state with missing tick-frames.json but run-summary.json present returns ok with null tickFrame", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "ak-rp-missing-tf-"));
  const runId = "run_rp_missing";
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir = join(workDir, "artifacts", "runs", runId, "run");

  // Build artifacts present; run-summary.json present so maxTick is known; tick-frames.json absent
  writeJson(join(buildDir, "sim-config.json"), {
    schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1,
    meta: makeMeta("sim_config", runId),
    layout: { kind: "grid", width: 7, height: 3,
      data: { width: 7, height: 3, tiles: ["#######", "#.....#", "#######"],
        legend: { "#": { tile: "wall" }, ".": { tile: "floor" } } } },
  });
  writeJson(join(buildDir, "initial-state.json"), {
    schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1,
    meta: makeMeta("initial_state", runId),
    actors: [{ id: "actor_delver", kind: "motivated", position: { x: 1, y: 1 } }],
  });
  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary", schemaVersion: 1,
    meta: makeMeta("run_summary", runId),
    outcome: "success", metrics: { ticks: 5 },
  });

  const result = runCli(["tick", "state", "--run-id", runId], workDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.tick, 0, "cursor starts at tick 0 with no session file");
  assert.equal(output.tickFrame, null, "tickFrame must be null when tick-frames.json is absent");
});
