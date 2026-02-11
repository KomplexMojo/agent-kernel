const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const ACTION_FIXTURE = resolve(ROOT, "tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json");

let VITAL_KEYS = [];

test.before(async () => {
  const shared = await import("../../packages/runtime/src/contracts/domain-constants.js");
  VITAL_KEYS = Array.from(shared.VITAL_KEYS);
});

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

function normalizeMeta(artifact) {
  const clone = JSON.parse(JSON.stringify(artifact));
  if (clone.meta) {
    delete clone.meta.id;
    delete clone.meta.runId;
    delete clone.meta.createdAt;
  }
  return clone;
}

function createGridArtifacts(dir) {
  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "sim_config",
      runId: "run_test",
      createdAt: "2025-01-01T00:00:00.000Z",
      producedBy: "test",
    },
    planRef: {
      id: "plan_test",
      schema: "agent-kernel/PlanArtifact",
      schemaVersion: 1,
    },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 3,
        height: 3,
        tiles: [
          "...",
          "...",
          "...",
        ],
        legend: {
          ".": { tile: "floor" },
          "#": { tile: "wall" },
          "S": { tile: "spawn" },
          "E": { tile: "exit" },
        },
        render: {
          wall: "#",
          floor: ".",
          spawn: "S",
          exit: "E",
          actor: "@",
        },
        spawn: { x: 0, y: 0 },
        exit: { x: 2, y: 2 },
      },
    },
  };
  const initialState = {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: "initial_state",
      runId: "run_test",
      createdAt: "2025-01-01T00:00:00.000Z",
      producedBy: "test",
    },
    simConfigRef: {
      id: simConfig.meta.id,
      schema: simConfig.schema,
      schemaVersion: simConfig.schemaVersion,
    },
    actors: [{ id: "actor_z", kind: "stationary" }],
  };
  const simConfigPath = join(dir, "sim-config.json");
  const initialStatePath = join(dir, "initial-state.json");
  writeJson(simConfigPath, simConfig);
  writeJson(initialStatePath, initialState);
  return { simConfigPath, initialStatePath };
}

test("cli run emits deterministic actor configs and action logs", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-determinism-"));
  const { simConfigPath, initialStatePath } = createGridArtifacts(workDir);
  const outDirA = join(workDir, "out-a");
  const outDirB = join(workDir, "out-b");

  const args = [
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--wasm",
    WASM_PATH,
    "--actions",
    ACTION_FIXTURE,
    "--actor",
    "actor_b,1,1,motivated",
    "--actor",
    "actor_a,2,1,stationary",
    "--vital",
    "actor_b,health,5,9,1",
    "--vital-default",
    "stamina,2,2,0",
    "--tile-wall",
    "0,0",
    "--tile-barrier",
    "1,0",
  ];

  runCli([...args, "--out-dir", outDirA]);
  runCli([...args, "--out-dir", outDirB]);

  const simA = normalizeMeta(readJson(join(outDirA, "resolved-sim-config.json")));
  const simB = normalizeMeta(readJson(join(outDirB, "resolved-sim-config.json")));
  const initA = normalizeMeta(readJson(join(outDirA, "resolved-initial-state.json")));
  const initB = normalizeMeta(readJson(join(outDirB, "resolved-initial-state.json")));
  const actionsA = normalizeMeta(readJson(join(outDirA, "action-log.json")));
  const actionsB = normalizeMeta(readJson(join(outDirB, "action-log.json")));
  const actionFixture = readJson(ACTION_FIXTURE);

  assert.deepEqual(simA, simB);
  assert.deepEqual(initA, initB);
  assert.deepEqual(actionsA, actionsB);
  assert.deepEqual(actionsA.actions, actionFixture.actions);

  const actorIds = initA.actors.map((actor) => actor.id);
  assert.deepEqual(actorIds, [...actorIds].sort());
  const actorB = initA.actors.find((actor) => actor.id === "actor_b");
  assert.ok(actorB);
  assert.deepEqual(Object.keys(actorB.vitals), VITAL_KEYS);
  assert.deepEqual(actorB.vitals.health, { current: 5, max: 9, regen: 1 });
});

test("cli run normalizes action logs without fixture input", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-determinism-"));
  const { simConfigPath, initialStatePath } = createGridArtifacts(workDir);
  const outDirA = join(workDir, "out-c");
  const outDirB = join(workDir, "out-d");

  const args = [
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--wasm",
    WASM_PATH,
    "--actor",
    "actor_b,1,1,motivated",
  ];

  runCli([...args, "--out-dir", outDirA]);
  runCli([...args, "--out-dir", outDirB]);

  const actionsA = normalizeMeta(readJson(join(outDirA, "action-log.json")));
  const actionsB = normalizeMeta(readJson(join(outDirB, "action-log.json")));
  assert.deepEqual(actionsA, actionsB);
});
