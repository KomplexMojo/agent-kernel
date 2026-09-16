const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, existsSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const INVALID_SIM_CONFIG = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/sim-config-artifact-v2.json",
);
const INVALID_SIM_CONFIG_MISSING_VERSION = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/sim-config-artifact-v1-missing-schema-version.json",
);
const INVALID_INITIAL_STATE = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/initial-state-artifact-v2.json",
);
const INVALID_INITIAL_STATE_MISMATCHED_SCHEMA = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/initial-state-artifact-v1-mismatched-schema.json",
);
const INVALID_PLAN = resolve(
  ROOT,
  "tests/fixtures/artifacts/invalid/plan-artifact-v2.json",
);

function runCliExpectFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
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

async function createGridArtifacts(dir) {
  const { buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width: 2,
    height: 2,
    terrain: ["floor", "floor", "floor", "floor"],
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

test("cli solve rejects missing scenario", () => {
  const result = runCliExpectFailure(["solve"]);
  assert.match(result.stderr, /solve requires/);
});

test("cli run rejects missing args", () => {
  const result = runCliExpectFailure(["run"]);
  assert.match(result.stderr, /run requires --sim-config and --initial-state/);
});

test("cli run rejects missing --from-run artifacts", () => {
  const tempDir = createTempDir("agent-kernel-cli-error-from-run-");
  const result = runCliExpectFailure(["run", "--from-run", "run_missing"], { cwd: tempDir });
  assert.match(result.stderr, /--from-run could not find artifacts for run run_missing/);
});

test("cli replay rejects missing tick frames", () => {
  const result = runCliExpectFailure(["replay", "--sim-config", "x", "--initial-state", "y"]);
  assert.match(result.stderr, /replay requires --sim-config, --initial-state, and --tick-frames/);
});

test("cli narrate rejects missing args", () => {
  const result = runCliExpectFailure(["narrate"]);
  assert.match(result.stderr, /narrate requires --tick-frames and --initial-state/);
});

test("cli ipfs rejects missing cid", () => {
  const result = runCliExpectFailure(["ipfs"]);
  assert.match(result.stderr, /ipfs requires --cid/);
});

test("cli blockchain rejects missing rpc-url", () => {
  const result = runCliExpectFailure(["blockchain"]);
  assert.match(result.stderr, /blockchain requires --rpc-url/);
});

test("cli blockchain-mint rejects missing rpc-url", () => {
  const result = runCliExpectFailure(["blockchain-mint", "--card", "tests/fixtures/adapters/card-config-delver.json"]);
  assert.match(result.stderr, /blockchain-mint requires --rpc-url/);
});

test("cli blockchain-mint rejects missing card", () => {
  const result = runCliExpectFailure(["blockchain-mint", "--rpc-url", "http://local"]);
  assert.match(result.stderr, /blockchain-mint requires --card/);
});

test("cli blockchain-load rejects missing token-id", () => {
  const result = runCliExpectFailure(["blockchain-load", "--rpc-url", "http://local"]);
  assert.match(result.stderr, /blockchain-load requires --token-id/);
});

test("cli llm rejects missing args", () => {
  const result = runCliExpectFailure(["llm"]);
  assert.match(result.stderr, /llm requires --prompt/);
});

test("cli run rejects schema mismatch", (t) => {
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
    initialStatePath,  ]);
  assert.match(result.stderr, /Expected schema/);
});

test("cli run rejects initial state schema mismatch", (t) => {
  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    INVALID_SIM_CONFIG,
    "--initial-state",
    INVALID_INITIAL_STATE,  ]);
  assert.match(result.stderr, /Expected schemaVersion 1/);
});

test("cli run rejects sim config missing schemaVersion", (t) => {
  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    INVALID_SIM_CONFIG_MISSING_VERSION,
    "--initial-state",
    resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-basic.json"),  ]);
  assert.match(result.stderr, /Expected schemaVersion 1/);
});

test("cli run rejects initial state schema kind mismatch", (t) => {
  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-basic.json"),
    "--initial-state",
    INVALID_INITIAL_STATE_MISMATCHED_SCHEMA,  ]);
  assert.match(result.stderr, /Expected schema/);
});

test("cli run rejects leftover tile-wall overrides outside terrain bounds", async () => {
  const tempDir = createTempDir("agent-kernel-cli-override-");
  const { simConfigPath, initialStatePath } = await createGridArtifacts(tempDir);
  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--tile-wall",
    "5,5",
  ]);
  assert.match(result.stderr, /tile override out of bounds/);
});

test("cli run converts leftover tile-barrier into a barrier actor", async () => {
  const tempDir = createTempDir("agent-kernel-cli-barrier-");
  const { simConfigPath, initialStatePath } = await createGridArtifacts(tempDir);
  const outDir = join(tempDir, "out");
  const result = spawnSync(process.execPath, [
    CLI,
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--tile-barrier",
    "1,1",
    "--out-dir",
    outDir,
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(readFileSync(join(outDir, "resolved-initial-state.json"), "utf8"));
  assert.equal(resolved.presentation?.barrier_1_1?.category, "barrier");
  const barrier = resolved.actors.find((actor) => actor.id === "barrier_1_1");
  assert.ok(barrier, "barrier actor must be in resolved initial-state");
  assert.deepEqual(barrier.position, { x: 1, y: 1 });
  assert.equal(barrier.capabilities?.blocksMovement, true);
});

test("cli run rejects malformed vital specs", async () => {
  const tempDir = createTempDir("agent-kernel-cli-override-");
  const { simConfigPath, initialStatePath } = await createGridArtifacts(tempDir);
  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--vital",
    "actor_1,health,1,2",
  ]);
  assert.match(result.stderr, /--vital expects actorId,vital,current,max,regen/);
});

test("cli run rejects invalid actor kind", async () => {
  const tempDir = createTempDir("agent-kernel-cli-override-");
  const { simConfigPath, initialStatePath } = await createGridArtifacts(tempDir);
  const result = runCliExpectFailure([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--actor",
    "actor_x,0,0,unknown",
  ]);
  assert.match(result.stderr, /--actor kind|unknown actor field/);
});

test("cli solve rejects plan schema mismatch", () => {
  const result = runCliExpectFailure([
    "solve",
    "--plan",
    INVALID_PLAN,
  ]);
  assert.match(result.stderr, /Expected schemaVersion 1/);
});
