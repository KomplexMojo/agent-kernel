const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
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

async function createSimArtifacts(dir) {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => "2026-01-01T00:00:00.000Z" });
  const layout = { width: 2, height: 1, terrain: ["floor", "exit"] };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: createMeta({ id: "sim_config" }),
    planRef: { id: "plan_test", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { actor_1: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: createMeta({ id: "initial_state" }),
    simConfigRef: {
      id: simConfig.meta.id,
      schema: simConfig.schema,
      schemaVersion: simConfig.schemaVersion,
    },
    dimensions: { width: 2, height: 1 },
    terrain: layout.terrain,
    actors: [{
      id: "actor_1",
      category: "delver",
      position: { x: 0, y: 0 },
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

test("cli run writes tick frames and logs", async () => {
  const workDir = makeTempDir("agent-kernel-run-");
  const { simConfigPath, initialStatePath } = await createSimArtifacts(workDir);
  const outDir = join(workDir, "out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",    "--out-dir",
    outDir,
  ]);

  const tickFramesPath = join(outDir, "tick-frames.json");
  const effectsLogPath = join(outDir, "effects-log.json");
  const runtimeDecisionCapturesPath = join(outDir, "runtime-decision-captures.json");
  const runSummaryPath = join(outDir, "run-summary.json");
  assert.ok(existsSync(tickFramesPath));
  assert.ok(existsSync(effectsLogPath));
  assert.ok(existsSync(runtimeDecisionCapturesPath));
  assert.ok(existsSync(runSummaryPath));

  const frames = readJson(tickFramesPath);
  const runtimeDecisionCaptures = readJson(runtimeDecisionCapturesPath);
  assert.ok(Array.isArray(frames));
  assert.ok(frames.length > 0);
  assert.ok(Array.isArray(runtimeDecisionCaptures));
  assert.equal(frames[0].schema, "agent-kernel/TickFrame");
});

test("cli run --progress emits JSON lines to stderr without polluting stdout", async () => {
  const workDir = makeTempDir("agent-kernel-run-progress-");
  const { simConfigPath, initialStatePath } = await createSimArtifacts(workDir);
  const outDir = join(workDir, "out");

  const result = runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "2",
    "--progress",    "--out-dir",
    outDir,
  ]);

  const stdoutSummary = JSON.parse(result.stdout.trim());
  const stderrLines = result.stderr.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

  assert.equal(stdoutSummary.ok, true);
  assert.equal(stdoutSummary.command, "run");
  assert.equal(stderrLines.length, 3);
  assert.deepEqual(
    stderrLines.map((line) => ({
      progress: line.progress,
      tick: line.tick,
      phase: line.phase,
      done: line.done,
    })),
    [
      { progress: true, tick: 1, phase: "emit", done: undefined },
      { progress: true, tick: 2, phase: "emit", done: undefined },
      { progress: true, tick: undefined, phase: undefined, done: true },
    ],
  );
  assert.equal(stderrLines[2].totalTicks, 2);
});

test("cli run resolves sim artifacts from --from-run", async () => {
  const workspaceDir = makeTempDir("agent-kernel-run-from-run-");
  const sourceRunId = "run_source_fixture";
  const sourceDir = join(workspaceDir, "artifacts", "runs", sourceRunId, "build");
  const outDir = join(workspaceDir, "artifacts", "runs", "run_from_source", "run");

  mkdirSync(sourceDir, { recursive: true });
  await createSimArtifacts(sourceDir);

  runCli(
    [
      "run",
      "--from-run",
      sourceRunId,
      "--ticks",
      "1",      "--run-id",
      "run_from_source",
      "--out-dir",
      outDir,
    ],
    { cwd: workspaceDir },
  );

  assert.ok(existsSync(join(outDir, "tick-frames.json")));
  assert.ok(existsSync(join(outDir, "effects-log.json")));
  assert.ok(existsSync(join(outDir, "run-summary.json")));
});

test("cli run dry-run validates sim artifacts without executing runtime outputs", async () => {
  const workDir = makeTempDir("agent-kernel-run-dry-run-");
  const { simConfigPath, initialStatePath } = await createSimArtifacts(workDir);
  const outDir = join(workDir, "out");

  const result = runCli([
    "run",
    "--dry-run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",
    "--out-dir",
    outDir,
  ]);

  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.ok, true);
  assert.equal(summary.command, "run");
  assert.equal(summary.valid, true);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.outDir, outDir);
  assert.equal(summary.ticks, 1);
  assert.deepEqual(summary.actorIds, ["actor_1"]);
  assert.equal(existsSync(join(outDir, "tick-frames.json")), false);
  assert.equal(existsSync(join(outDir, "run-summary.json")), false);
});

test("cli replay writes replay summary", async () => {
  const workDir = makeTempDir("agent-kernel-replay-");
  const { simConfigPath, initialStatePath } = await createSimArtifacts(workDir);
  const runOutDir = join(workDir, "run-out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",    "--out-dir",
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
    tickFramesPath,    "--out-dir",
    replayOutDir,
  ]);

  const replaySummaryPath = join(replayOutDir, "replay-summary.json");
  const replayFramesPath = join(replayOutDir, "replay-tick-frames.json");
  assert.ok(existsSync(replaySummaryPath));
  assert.ok(existsSync(replayFramesPath));

  const summary = readJson(replaySummaryPath);
  assert.equal(typeof summary.match, "boolean");
  assert.ok(summary.runtimeDecisions);
  assert.equal(typeof summary.runtimeDecisions.match, "boolean");
});

test("cli inspect writes summary", async () => {
  const workDir = makeTempDir("agent-kernel-inspect-");
  const { simConfigPath, initialStatePath } = await createSimArtifacts(workDir);
  const runOutDir = join(workDir, "run-out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "1",    "--out-dir",
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
  assert.ok(summary.data.runtimeDecisions);
  assert.equal(typeof summary.data.runtimeDecisions.total, "number");
});
