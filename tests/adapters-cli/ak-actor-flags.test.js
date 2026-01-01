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

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function createGridArtifacts(dir) {
  const planRef = {
    id: "plan_test",
    schema: "agent-kernel/PlanArtifact",
    schemaVersion: 1,
  };
  const simConfig = {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: "sim_config",
      runId: "run_test",
      createdAt: "2025-01-01T00:00:00.000Z",
      producedBy: "test",
    },
    planRef,
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
    actors: [{ id: "actor_1", kind: "stationary" }],
  };
  const simConfigPath = join(dir, "sim-config.json");
  const initialStatePath = join(dir, "initial-state.json");
  writeJson(simConfigPath, simConfig);
  writeJson(initialStatePath, initialState);
  return { simConfigPath, initialStatePath };
}

test("cli run applies actor/vital/tile overrides and emits resolved artifacts", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-actors-"));
  const { simConfigPath, initialStatePath } = createGridArtifacts(workDir);
  const outDir = join(workDir, "out");

  runCli([
    "run",
    "--sim-config",
    simConfigPath,
    "--initial-state",
    initialStatePath,
    "--ticks",
    "0",
    "--wasm",
    WASM_PATH,
    "--out-dir",
    outDir,
    "--actor",
    "actor_mvp,1,1,motivated",
    "--vital",
    "actor_mvp,health,5,9,1",
    "--vital-default",
    "stamina,2,2,0",
    "--tile-wall",
    "0,0",
    "--tile-barrier",
    "1,0",
    "--tile-floor",
    "2,0",
  ]);

  const resolvedSim = readJson(join(outDir, "resolved-sim-config.json"));
  const resolvedState = readJson(join(outDir, "resolved-initial-state.json"));
  assert.deepEqual(resolvedSim.layout.data.tiles[0], "#B.");
  assert.equal(resolvedSim.layout.data.legend["B"].tile, "barrier");
  assert.equal(resolvedSim.layout.data.render.barrier, "B");

  const actor = resolvedState.actors.find((entry) => entry.id === "actor_mvp");
  assert.ok(actor);
  assert.equal(actor.kind, "ambulatory");
  assert.deepEqual(actor.position, { x: 1, y: 1 });
  assert.deepEqual(actor.vitals.health, { current: 5, max: 9, regen: 1 });
  assert.deepEqual(actor.vitals.stamina, { current: 2, max: 2, regen: 0 });
  assert.deepEqual(actor.vitals.mana, { current: 0, max: 0, regen: 0 });
  assert.deepEqual(actor.vitals.durability, { current: 0, max: 0, regen: 0 });
});
