const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-basic.json");
const INITIAL_STATE = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-basic.json");
const PLAN = resolve(ROOT, "tests/fixtures/artifacts/plan-artifact-v1-basic.json");

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeFrames(frames) {
  return frames.map((frame) => {
    const clone = JSON.parse(JSON.stringify(frame));
    if (clone.meta) {
      delete clone.meta.id;
      delete clone.meta.runId;
      delete clone.meta.createdAt;
    }
    return clone;
  });
}

test("cli solve produces stable solver request fields", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-solve-golden-"));
  runCli(["solve", "--plan", PLAN, "--out-dir", outDir]);
  const request = readJson(join(outDir, "solver-request.json"));
  const result = readJson(join(outDir, "solver-result.json"));
  assert.equal(request.schema, "agent-kernel/SolverRequest");
  assert.equal(request.planRef.id, "plan_basic");
  assert.equal(result.schema, "agent-kernel/SolverResult");
  assert.equal(result.requestRef.schema, "agent-kernel/SolverRequest");
});

test("cli run outputs deterministic frames for fixed inputs", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const outDirA = mkdtempSync(join(os.tmpdir(), "agent-kernel-run-a-"));
  const outDirB = mkdtempSync(join(os.tmpdir(), "agent-kernel-run-b-"));

  runCli([
    "run",
    "--sim-config",
    SIM_CONFIG,
    "--initial-state",
    INITIAL_STATE,
    "--ticks",
    "1",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    outDirA,
  ]);
  runCli([
    "run",
    "--sim-config",
    SIM_CONFIG,
    "--initial-state",
    INITIAL_STATE,
    "--ticks",
    "1",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    outDirB,
  ]);

  const framesA = normalizeFrames(readJson(join(outDirA, "tick-frames.json")));
  const framesB = normalizeFrames(readJson(join(outDirB, "tick-frames.json")));
  assert.deepEqual(framesA, framesB);
});

test("cli replay and inspect produce stable schemas", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const runOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-run-c-"));
  runCli([
    "run",
    "--sim-config",
    SIM_CONFIG,
    "--initial-state",
    INITIAL_STATE,
    "--ticks",
    "1",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    runOutDir,
  ]);

  const tickFramesPath = join(runOutDir, "tick-frames.json");
  const effectsLogPath = join(runOutDir, "effects-log.json");

  const replayOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-replay-"));
  runCli([
    "replay",
    "--sim-config",
    SIM_CONFIG,
    "--initial-state",
    INITIAL_STATE,
    "--tick-frames",
    tickFramesPath,
    "--wasm",
    WASM_PATH,
    "--out-dir",
    replayOutDir,
  ]);

  const replaySummary = readJson(join(replayOutDir, "replay-summary.json"));
  assert.equal(replaySummary.match, true);

  const inspectOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-inspect-"));
  runCli([
    "inspect",
    "--tick-frames",
    tickFramesPath,
    "--effects-log",
    effectsLogPath,
    "--out-dir",
    inspectOutDir,
  ]);

  const inspectSummary = readJson(join(inspectOutDir, "inspect-summary.json"));
  assert.equal(inspectSummary.schema, "agent-kernel/TelemetryRecord");
  assert.equal(inspectSummary.schemaVersion, 1);
});
