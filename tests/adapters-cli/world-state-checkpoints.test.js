"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

async function unifiedArtifacts() {
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/controller.js"
  );
  const clock = () => "2026-01-01T00:00:00.000Z";
  const configurator = createConfiguratorPersona({ clock });
  const layout = {
    width: 4,
    height: 1,
    terrain: ["floor", "floor", "floor", "exit"],
    exitApproach: { x: 2, y: 0 },
  };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "checkpoint-config", runId: "checkpoint_fixture", createdAt: clock() },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout,
    movementStamina: { walker: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "checkpoint-state", runId: "checkpoint_fixture", createdAt: clock() },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 4, height: 1 },
    terrain: layout.terrain,
    actors: [
      {
        id: "walker",
        category: "delver",
        position: { x: 0, y: 0 },
        motivations: ["exploring"],
        vitals: { health: { current: 10, max: 10, regen: 0 } },
        affinities: [{ kind: "water", expression: "emit", stacks: 2 }],
        activeAffinityKey: "water:emit",
      },
      {
        id: "flame",
        category: "hazard",
        position: { x: 2, y: 0 },
        vitals: {
          durability: { current: 5, max: 5, regen: 0 },
          mana: { current: 0, max: 3, regen: 1 },
        },
        affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
        activeAffinityKey: "fire:emit",
      },
    ],
  });
  return { simConfig, initialState };
}

async function writeArtifacts(dir) {
  const { simConfig, initialState } = await unifiedArtifacts();
  const simConfigPath = join(dir, "sim-config.json");
  const initialStatePath = join(dir, "initial-state.json");
  writeFileSync(simConfigPath, `${JSON.stringify(simConfig, null, 2)}\n`);
  writeFileSync(initialStatePath, `${JSON.stringify(initialState, null, 2)}\n`);
  return { simConfigPath, initialStatePath };
}

function runArgs(outDir, checkpoints, paths) {
  const args = [
    "run",
    "--sim-config", paths.simConfigPath,
    "--initial-state", paths.initialStatePath,
    "--ticks", "3",
    "--seed", "7",
    "--run-id", "checkpoint_fixture",
    "--out-dir", outDir,
  ];
  if (checkpoints !== undefined) args.push("--world-state-checkpoints", checkpoints);
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizedState(value) {
  const { meta, ...state } = value;
  return state;
}

function flameMana(checkpoint) {
  return checkpoint.actors.find((actor) => actor.id === "flame").vitals.mana.current;
}

test("ak run emits only requested WorldStateArtifact checkpoints", async () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoints-"));
  try {
    const paths = await writeArtifacts(root);
    const outDir = join(root, "with-checkpoints");
    const result = runCli(runArgs(outDir, "0,1,3", paths));
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const checkpointDir = join(outDir, "world-state-checkpoints");
    assert.deepEqual(readdirSync(checkpointDir).sort(), [
      "tick-000000.json",
      "tick-000001.json",
      "tick-000003.json",
    ]);

    const initial = readJson(join(checkpointDir, "tick-000000.json"));
    const intermediate = readJson(join(checkpointDir, "tick-000001.json"));
    const final = readJson(join(checkpointDir, "tick-000003.json"));
    for (const [expectedTick, checkpoint] of [[0, initial], [1, intermediate], [3, final]]) {
      assert.equal(checkpoint.schema, "agent-kernel/WorldStateArtifact");
      assert.equal(checkpoint.schemaVersion, 2);
      assert.equal(checkpoint.tick, expectedTick);
      assert.equal(checkpoint.meta.producedBy, "annotator");
      assert.equal(checkpoint.meta.runId, "checkpoint_fixture");
      assert.equal(Object.hasOwn(checkpoint, "hazards"), false);
      assert.ok(checkpoint.actors.every((actor) => Array.isArray(actor.affinities)));
      assert.doesNotThrow(() => JSON.stringify(checkpoint));
    }
    assert.notEqual(
      flameMana(initial),
      flameMana(final),
      "checkpoint files must expose live hazard vitals, not repeat authored input or freeze the first tick",
    );

    assert.deepEqual(
      normalizedState(final),
      normalizedState(readJson(join(outDir, "world-state.json"))),
      "the requested final checkpoint and normal final-state output must describe the same world",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run dry-run validates and reports normalized checkpoint ticks", async () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoint-dry-run-"));
  try {
    const paths = await writeArtifacts(root);
    const result = runCli([...runArgs(join(root, "out"), "0,1,3", paths), "--dry-run"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.valid, true);
    assert.deepEqual(output.worldStateCheckpoints, [0, 1, 3]);
    assert.equal(existsSync(join(root, "out")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the checkpoint source reports live equipment and holdings", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, ...(await unifiedArtifacts()) });
  const meta = {
    id: "state_live_affinity",
    runId: "checkpoint_fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    producedBy: "annotator",
  };
  const snapshot = runtime.captureWorldState({ meta });
  const walker = snapshot.actors.find((actor) => actor.id === "walker");
  assert.equal(walker.activeAffinityKey, "water:emit");
  assert.deepEqual(walker.affinities, [{ kind: "water", expression: "emit", stacks: 2 }]);
  assert.equal(Object.hasOwn(snapshot, "hazards"), false);
});

test("world-state checkpoints are opt-in and deterministic after metadata normalization", async () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoint-determinism-"));
  try {
    const paths = await writeArtifacts(root);
    const ordinaryDir = join(root, "ordinary");
    const ordinary = runCli(runArgs(ordinaryDir, undefined, paths));
    assert.equal(ordinary.status, 0, ordinary.stderr || ordinary.stdout);
    assert.equal(existsSync(join(ordinaryDir, "world-state-checkpoints")), false);
    assert.equal(existsSync(join(ordinaryDir, "world-state.json")), true);

    const firstDir = join(root, "first");
    const secondDir = join(root, "second");
    for (const outDir of [firstDir, secondDir]) {
      const result = runCli(runArgs(outDir, "0,1,3", paths));
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    for (const name of ["tick-000000.json", "tick-000001.json", "tick-000003.json"]) {
      assert.deepEqual(
        normalizedState(readJson(join(firstDir, "world-state-checkpoints", name))),
        normalizedState(readJson(join(secondDir, "world-state-checkpoints", name))),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("world-state checkpoint validation fails closed", async () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoint-invalid-"));
  try {
    const paths = await writeArtifacts(root);
    const invalid = [
      ["", /non-empty comma-separated list/],
      ["0,1,1", /must not contain duplicate tick 1/],
      ["0,2,1", /must be strictly ascending/],
      ["0,-1", /non-negative integers/],
      ["0,1.5", /non-negative integers/],
      ["0,4", /cannot exceed --ticks 3/],
    ];
    for (const [index, [value, pattern]] of invalid.entries()) {
      const result = runCli(runArgs(join(root, `invalid-${index}`), value, paths));
      assert.notEqual(result.status, 0, `expected ${JSON.stringify(value)} to fail`);
      assert.match(result.stderr, pattern);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ## TODO: Test Permutations
// - a very large but safe tick horizon preserves deterministic filename padding
// - direct command-kernel callers may pass a numeric checkpoint array
