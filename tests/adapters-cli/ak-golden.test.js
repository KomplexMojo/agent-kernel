const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

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

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function writeUnifiedRunArtifacts(dir) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const width = 3;
  const height = 3;
  const terrain = boxedTerrain(width, height);
  terrain[1 * width + 1] = "floor";
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width,
    height,
    terrain,
    actors: [{
      id: "actor_1",
      category: "delver",
      position: { x: 1, y: 1 },
      motivations: ["exploring"],
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    }],
  });
  const simConfigPath = join(dir, "sim-config.json");
  const initialStatePath = join(dir, "initial-state.json");
  writeJson(simConfigPath, simConfig);
  writeJson(initialStatePath, initialState);
  return { simConfigPath, initialStatePath };
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

test("cli run outputs deterministic frames for fixed inputs", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-run-golden-"));
  const { simConfigPath, initialStatePath } = await writeUnifiedRunArtifacts(workDir);
  const outDirA = join(workDir, "out-a");
  const outDirB = join(workDir, "out-b");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",
    "--out-dir",
    outDirA,
  ]);
  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",
    "--out-dir",
    outDirB,
  ]);

  const framesA = normalizeFrames(readJson(join(outDirA, "tick-frames.json")));
  const framesB = normalizeFrames(readJson(join(outDirB, "tick-frames.json")));
  assert.deepEqual(framesA, framesB);
});

test("cli replay and inspect produce stable schemas", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-run-c-"));
  const { simConfigPath, initialStatePath } = await writeUnifiedRunArtifacts(workDir);
  const runOutDir = join(workDir, "run-out");
  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",
    "--out-dir",
    runOutDir,
  ]);

  const tickFramesPath = join(runOutDir, "tick-frames.json");
  const effectsLogPath = join(runOutDir, "effects-log.json");

  const replayOutDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-replay-"));
  runCli([
    "replay",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--tick-frames",
    tickFramesPath,
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
