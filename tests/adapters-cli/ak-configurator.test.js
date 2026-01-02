const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

const LEVEL_GEN = resolve(ROOT, "tests/fixtures/configurator/level-gen-input-v1-trap.json");
const ACTORS = resolve(ROOT, "tests/fixtures/configurator/actors-v1-affinity-base.json");
const PRESETS = resolve(ROOT, "tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json");
const LOADOUTS = resolve(ROOT, "tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json");
const PLAN = resolve(ROOT, "tests/fixtures/artifacts/plan-artifact-v1-basic.json");
const BUDGET = resolve(ROOT, "tests/fixtures/artifacts/budget-receipt-v1-basic.json");
const EXPECTED_SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json");
const EXPECTED_INITIAL = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json");
const INVALID_LEVEL_GEN = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/configurator-level-gen-v1-missing-width.json",
);

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

test("cli configurator builds sim config and initial state artifacts", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-configurator-"));
  const outDir = join(workDir, "out");

  runCli([
    "configurator",
    "--level-gen",
    LEVEL_GEN,
    "--actors",
    ACTORS,
    "--affinity-presets",
    PRESETS,
    "--affinity-loadouts",
    LOADOUTS,
    "--plan",
    PLAN,
    "--budget-receipt",
    BUDGET,
    "--out-dir",
    outDir,
    "--run-id",
    "run_configurator_trap",
  ]);

  const simConfig = readJson(join(outDir, "sim-config.json"));
  const initialState = readJson(join(outDir, "initial-state.json"));
  const expectedSim = readJson(EXPECTED_SIM_CONFIG);
  const expectedInitial = readJson(EXPECTED_INITIAL);

  assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
  assert.equal(simConfig.schemaVersion, 1);
  assert.deepEqual(simConfig.layout, expectedSim.layout);
  assert.equal(simConfig.seed, expectedSim.seed);
  assert.deepEqual(simConfig.planRef, expectedSim.planRef);
  assert.deepEqual(simConfig.budgetReceiptRef, expectedSim.budgetReceiptRef);

  assert.equal(initialState.schema, "agent-kernel/InitialStateArtifact");
  assert.equal(initialState.schemaVersion, 1);
  assert.deepEqual(initialState.actors, expectedInitial.actors);
  assert.equal(initialState.simConfigRef.schema, simConfig.schema);
  assert.equal(initialState.simConfigRef.schemaVersion, simConfig.schemaVersion);
  assert.equal(initialState.simConfigRef.id, simConfig.meta.id);
});

test("cli configurator rejects invalid level-gen input", () => {
  const result = spawnSync(process.execPath, [
    CLI,
    "configurator",
    "--level-gen",
    INVALID_LEVEL_GEN,
    "--actors",
    ACTORS,
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /level-gen/i);
});
