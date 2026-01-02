const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const PRESETS = resolve(ROOT, "tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json");
const LOADOUTS = resolve(ROOT, "tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json");
const SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json");
const INITIAL_STATE = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json");
const AFFINITY_FIXTURE = resolve(ROOT, "tests/fixtures/personas/affinity-resolution-v1-basic.json");

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

test("cli run writes affinity summary", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-affinity-"));
  const outDir = join(workDir, "out");

  runCli([
    "run",
    "--sim-config",
    SIM_CONFIG,
    "--initial-state",
    INITIAL_STATE,
    "--ticks",
    "0",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    outDir,
    "--affinity-presets",
    PRESETS,
    "--affinity-loadouts",
    LOADOUTS,
    "--affinity-summary",
  ]);

  const summaryPath = join(outDir, "affinity-summary.json");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const expected = JSON.parse(readFileSync(AFFINITY_FIXTURE, "utf8")).expected;

  assert.equal(summary.schema, "agent-kernel/AffinitySummary");
  assert.equal(summary.schemaVersion, 1);
  assert.deepEqual(summary.actors, expected.actors);
  assert.deepEqual(summary.traps, expected.traps);
});

test("cli run rejects affinity summary without presets or loadouts", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-affinity-"));
  const outDir = join(workDir, "out");
  const result = spawnSync(process.execPath, [
    CLI,
    "run",
    "--sim-config",
    SIM_CONFIG,
    "--initial-state",
    INITIAL_STATE,
    "--ticks",
    "0",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    outDir,
    "--affinity-summary",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Affinity summary requires/);
});
