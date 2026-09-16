const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const ACTION_FIXTURE = resolve(ROOT, "tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json");

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

async function createGridArtifacts(dir) {
  const { buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const terrain = [
    "wall", "floor", "floor",
    "floor", "floor", "floor",
    "floor", "floor", "exit",
  ];
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width: 3,
    height: 3,
    terrain,
    actors: [
      {
        id: "actor_z",
        category: "delver",
        position: { x: 0, y: 1 },
        motivations: ["exploring"],
        vitals: { health: { current: 10, max: 10, regen: 0 } },
      },
      {
        id: "actor_b",
        category: "delver",
        position: { x: 1, y: 1 },
        motivations: ["exploring"],
        vitals: { health: { current: 5, max: 9, regen: 1 } },
      },
      {
        id: "actor_a",
        category: "delver",
        position: { x: 2, y: 1 },
        motivations: ["exploring"],
        vitals: { health: { current: 10, max: 10, regen: 0 } },
      },
      {
        id: "barrier_10",
        category: "barrier",
        position: { x: 1, y: 0 },
        vitals: { durability: { current: 1, max: 1, regen: 0 } },
      },
    ],
  });
  const simConfigPath = join(dir, "sim-config.json");
  const initialStatePath = join(dir, "initial-state.json");
  writeJson(simConfigPath, simConfig);
  writeJson(initialStatePath, initialState);
  return { simConfigPath, initialStatePath };
}

test("cli run emits deterministic actor configs and action logs", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-determinism-"));
  const { simConfigPath, initialStatePath } = await createGridArtifacts(workDir);
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
    "--actions",
    ACTION_FIXTURE,
  ];

  runCli([...args, "--out-dir", outDirA]);
  runCli([...args, "--out-dir", outDirB]);

  const worldA = normalizeMeta(readJson(join(outDirA, "world-state.json")));
  const worldB = normalizeMeta(readJson(join(outDirB, "world-state.json")));
  const actionsA = normalizeMeta(readJson(join(outDirA, "action-log.json")));
  const actionsB = normalizeMeta(readJson(join(outDirB, "action-log.json")));
  const actionFixture = readJson(ACTION_FIXTURE);

  assert.deepEqual(worldA, worldB);
  assert.deepEqual(actionsA, actionsB);
  assert.deepEqual(actionsA.actions, actionFixture.actions);

  const actorIds = worldA.actors.map((actor) => actor.id);
  assert.deepEqual(actorIds, [...actorIds].sort());
  const actorB = worldA.actors.find((actor) => actor.id === "actor_b");
  assert.ok(actorB);
  assert.deepEqual(actorB.vitals.health, { current: 5, max: 9, regen: 1 });
});

test("cli run normalizes action logs without fixture input", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-determinism-"));
  const { simConfigPath, initialStatePath } = await createGridArtifacts(workDir);
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
  ];

  runCli([...args, "--out-dir", outDirA]);
  runCli([...args, "--out-dir", outDirB]);

  const actionsA = normalizeMeta(readJson(join(outDirA, "action-log.json")));
  const actionsB = normalizeMeta(readJson(join(outDirB, "action-log.json")));
  assert.deepEqual(actionsA, actionsB);
});
