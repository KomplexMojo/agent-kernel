const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const INVALID_SIM_CONFIG = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/sim-config-artifact-v2.json",
);
const INVALID_INITIAL_STATE = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/initial-state-artifact-v2.json",
);
const INVALID_PLAN = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/plan-artifact-v2.json",
);

function runCliExpectFailure(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, "Expected CLI to fail");
  return result;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createTempDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

test("cli solve rejects missing scenario", () => {
  const result = runCliExpectFailure(["solve"]);
  assert.match(result.stderr, /solve requires/);
});

test("cli run rejects missing args", () => {
  const result = runCliExpectFailure(["run"]);
  assert.match(result.stderr, /run requires --sim-config and --initial-state/);
});

test("cli replay rejects missing tick frames", () => {
  const result = runCliExpectFailure(["replay", "--sim-config", "x", "--initial-state", "y"]);
  assert.match(result.stderr, /replay requires --sim-config, --initial-state, and --tick-frames/);
});

test("cli ipfs rejects missing cid", () => {
  const result = runCliExpectFailure(["ipfs"]);
  assert.match(result.stderr, /ipfs requires --cid/);
});

test("cli blockchain rejects missing rpc-url", () => {
  const result = runCliExpectFailure(["blockchain"]);
  assert.match(result.stderr, /blockchain requires --rpc-url/);
});

test("cli ollama rejects missing args", () => {
  const result = runCliExpectFailure(["ollama"]);
  assert.match(result.stderr, /ollama requires --model and --prompt/);
});

test("cli run rejects schema mismatch", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const tempDir = createTempDir("agent-kernel-cli-error-");
  const initialStatePath = join(tempDir, "initial-state.json");
  writeJson(initialStatePath, {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "initial_state",
      runId: "run_error",
      createdAt: new Date().toISOString(),
      producedBy: "test",
    },
    simConfigRef: {
      id: "sim_config",
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors: [{ id: "actor_1", kind: "stationary" }],
  });

  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    INVALID_SIM_CONFIG,
    "--initial-state",
    initialStatePath,
    "--wasm",
    WASM_PATH,
  ]);
  assert.match(result.stderr, /Expected schema/);
});

test("cli run rejects initial state schema mismatch", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    INVALID_SIM_CONFIG,
    "--initial-state",
    INVALID_INITIAL_STATE,
    "--wasm",
    WASM_PATH,
  ]);
  assert.match(result.stderr, /Expected schemaVersion 1/);
});

test("cli solve rejects plan schema mismatch", () => {
  const result = runCliExpectFailure([
    "solve",
    "--plan",
    INVALID_PLAN,
  ]);
  assert.match(result.stderr, /Expected schemaVersion 1/);
});
