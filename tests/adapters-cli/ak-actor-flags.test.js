const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
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

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
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
        id: "actor_1",
        category: "delver",
        position: { x: 0, y: 1 },
        motivations: ["exploring"],
        vitals: { health: { current: 10, max: 10, regen: 0 } },
      },
      {
        id: "actor_mvp",
        category: "delver",
        position: { x: 1, y: 1 },
        motivations: ["exploring"],
        vitals: { health: { current: 5, max: 9, regen: 1 } },
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

test("cli run preserves Configurator-authored wall, barrier, and actor vitals", async () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-actors-"));
  const { simConfigPath, initialStatePath } = await createGridArtifacts(workDir);
  const outDir = join(workDir, "out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--out-dir",
    outDir,
  ]);

  const simConfig = readJson(simConfigPath);
  const authored = readJson(initialStatePath);
  const world = readJson(join(outDir, "world-state.json"));
  assert.equal(simConfig.layout.data.terrain[0], "wall");
  const barrier = world.actors.find((entry) => entry.id === "barrier_10");
  assert.ok(barrier);
  assert.deepEqual(barrier.position, { x: 1, y: 0 });

  const actor = world.actors.find((entry) => entry.id === "actor_mvp");
  assert.ok(actor);
  assert.equal(authored.presentation.actor_mvp.category, "delver");
  assert.equal(actor.capabilities.canMove, true);
  assert.deepEqual(actor.position, { x: 1, y: 1 });
  assert.deepEqual(actor.vitals.health, { current: 5, max: 9, regen: 1 });
});
