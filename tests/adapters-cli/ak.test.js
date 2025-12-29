const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

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

function makeTempDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function createMeta(overrides = {}) {
  return {
    id: overrides.id || "artifact_test",
    runId: overrides.runId || "run_test",
    createdAt: overrides.createdAt || new Date().toISOString(),
    producedBy: overrides.producedBy || "test",
  };
}

function createSimArtifacts(dir) {
  const planRef = {
    id: "plan_test",
    schema: "agent-kernel/PlanArtifact",
    schemaVersion: 1,
  };
  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: createMeta({ id: "sim_config" }),
    planRef,
    seed: 0,
    layout: {
      kind: "grid",
      data: {},
    },
  };
  const initialState = {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: createMeta({ id: "initial_state" }),
    simConfigRef: {
      id: simConfig.meta.id,
      schema: simConfig.schema,
      schemaVersion: simConfig.schemaVersion,
    },
    actors: [
      { id: "actor_1", kind: "stationary" },
    ],
  };
  const simConfigPath = join(dir, "sim-config.json");
  const initialStatePath = join(dir, "initial-state.json");
  writeJson(simConfigPath, simConfig);
  writeJson(initialStatePath, initialState);
  return { simConfigPath, initialStatePath };
}

test("cli solve writes solver artifacts", () => {
  const outDir = makeTempDir("agent-kernel-solve-");
  runCli(["solve", "--scenario", "two actors conflict", "--out-dir", outDir]);

  const requestPath = join(outDir, "solver-request.json");
  const resultPath = join(outDir, "solver-result.json");
  assert.ok(existsSync(requestPath));
  assert.ok(existsSync(resultPath));

  const request = readJson(requestPath);
  const result = readJson(resultPath);
  assert.equal(request.schema, "agent-kernel/SolverRequest");
  assert.equal(request.schemaVersion, 1);
  assert.equal(result.schema, "agent-kernel/SolverResult");
  assert.equal(result.schemaVersion, 1);
});

test("cli run writes tick frames and logs", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = makeTempDir("agent-kernel-run-");
  const { simConfigPath, initialStatePath } = createSimArtifacts(workDir);
  const outDir = join(workDir, "out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    outDir,
  ]);

  const tickFramesPath = join(outDir, "tick-frames.json");
  const effectsLogPath = join(outDir, "effects-log.json");
  const runSummaryPath = join(outDir, "run-summary.json");
  assert.ok(existsSync(tickFramesPath));
  assert.ok(existsSync(effectsLogPath));
  assert.ok(existsSync(runSummaryPath));

  const frames = readJson(tickFramesPath);
  assert.ok(Array.isArray(frames));
  assert.ok(frames.length > 0);
  assert.equal(frames[0].schema, "agent-kernel/TickFrame");
});

test("cli replay writes replay summary", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = makeTempDir("agent-kernel-replay-");
  const { simConfigPath, initialStatePath } = createSimArtifacts(workDir);
  const runOutDir = join(workDir, "run-out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    runOutDir,
  ]);

  const tickFramesPath = join(runOutDir, "tick-frames.json");
  const replayOutDir = join(workDir, "replay-out");

  runCli([
    "replay",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--tick-frames",
    tickFramesPath,
    "--wasm",
    WASM_PATH,
    "--out-dir",
    replayOutDir,
  ]);

  const replaySummaryPath = join(replayOutDir, "replay-summary.json");
  const replayFramesPath = join(replayOutDir, "replay-tick-frames.json");
  assert.ok(existsSync(replaySummaryPath));
  assert.ok(existsSync(replayFramesPath));

  const summary = readJson(replaySummaryPath);
  assert.equal(typeof summary.match, "boolean");
});

test("cli inspect writes summary", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = makeTempDir("agent-kernel-inspect-");
  const { simConfigPath, initialStatePath } = createSimArtifacts(workDir);
  const runOutDir = join(workDir, "run-out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    runOutDir,
  ]);

  const tickFramesPath = join(runOutDir, "tick-frames.json");
  const effectsLogPath = join(runOutDir, "effects-log.json");
  const inspectOutDir = join(workDir, "inspect-out");

  runCli([
    "inspect",
    "--tick-frames",
    tickFramesPath,
    "--effects-log",
    effectsLogPath,
    "--out-dir",
    inspectOutDir,
  ]);

  const inspectSummaryPath = join(inspectOutDir, "inspect-summary.json");
  assert.ok(existsSync(inspectSummaryPath));
  const summary = readJson(inspectSummaryPath);
  assert.equal(summary.schema, "agent-kernel/TelemetryRecord");
  assert.equal(summary.schemaVersion, 1);
});
