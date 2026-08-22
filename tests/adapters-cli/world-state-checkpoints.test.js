"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const SIM_CONFIG = resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-hazard.json");
const INITIAL_STATE = resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

function runArgs(outDir, checkpoints, simConfig = SIM_CONFIG) {
  const args = [
    "run",
    "--sim-config", simConfig,
    "--initial-state", INITIAL_STATE,
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

test("ak run emits only requested WorldStateArtifact v1 checkpoints", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoints-"));
  try {
    const simConfig = readJson(SIM_CONFIG);
    simConfig.layout.data.hazards[0].vitals.mana = { current: 0, max: 3, regen: 1 };
    const simConfigPath = join(root, "sim-config.json");
    writeFileSync(simConfigPath, `${JSON.stringify(simConfig, null, 2)}\n`);
    const outDir = join(root, "with-checkpoints");
    const result = runCli(runArgs(outDir, "0,1,3", simConfigPath));
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
      assert.equal(checkpoint.schemaVersion, 1);
      assert.equal(checkpoint.tick, expectedTick);
      assert.equal(checkpoint.meta.producedBy, "annotator");
      assert.equal(checkpoint.meta.runId, "checkpoint_fixture");
      assert.ok(checkpoint.actors.every((actor) => Array.isArray(actor.affinities)));
      assert.doesNotThrow(() => JSON.stringify(checkpoint));
    }
    assert.deepEqual(
      [initial, intermediate, final].map((checkpoint) => checkpoint.hazards[0].mana.current),
      [0, 1, 3],
      "checkpoint files must expose live hazard state, not repeat authored input or final state",
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

test("run dry-run validates and reports normalized checkpoint ticks", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoint-dry-run-"));
  try {
    const result = runCli([...runArgs(join(root, "out"), "0,1,3"), "--dry-run"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.valid, true);
    assert.deepEqual(output.worldStateCheckpoints, [0, 1, 3]);
    assert.equal(existsSync(join(root, "out")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the checkpoint source reports live affinity grant mana and expiry", async () => {
  const [{ createRuntime }, { ActionKind, createCore }, { AffinityKind, AffinityExpression }, { Direction }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/core-ts/src/state/affinity.ts"),
    import("../../packages/core-ts/src/rules/move.ts"),
  ]);
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });
  const initialState = readJson(INITIAL_STATE);
  initialState.actors[0].vitals.stamina = { current: 10, max: 10, regen: 0 };
  await runtime.init({
    seed: 0,
    simConfig: readJson(SIM_CONFIG),
    initialState,
  });

  assert.equal(core.placeAffinityResourceAt(1, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 8, 0), 1);
  const actorId = core.getMotivatedActorIdByIndex(0);
  core.setActiveMotivatedActor(actorId);
  core.setMoveAction(actorId, 2, 1, 1, 1, Direction.West, core.getCurrentTick() + 1);
  core.applyAction(ActionKind.Move, 0);

  const meta = { id: "state_live_affinity", runId: "checkpoint_fixture", createdAt: "2026-01-01T00:00:00.000Z", producedBy: "annotator" };
  const granted = runtime.captureWorldState({ meta });
  assert.deepEqual(granted.actors[0].affinities, [{
    kind: AffinityKind.Water,
    expression: AffinityExpression.Emit,
    stacks: 2,
    mana: 8,
    manaMax: 8,
    manaRegen: 0,
  }]);

  core.spendMotivatedActorAffinityMana(0, AffinityKind.Water, 8);
  const expired = runtime.captureWorldState({ meta });
  assert.deepEqual(expired.actors[0].affinities, [], "spent temporary grants must disappear from checkpoint state");
});

test("world-state checkpoints are opt-in and deterministic after metadata normalization", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoint-determinism-"));
  try {
    const ordinaryDir = join(root, "ordinary");
    const ordinary = runCli(runArgs(ordinaryDir));
    assert.equal(ordinary.status, 0, ordinary.stderr || ordinary.stdout);
    assert.equal(existsSync(join(ordinaryDir, "world-state-checkpoints")), false);
    assert.equal(existsSync(join(ordinaryDir, "world-state.json")), true);

    const firstDir = join(root, "first");
    const secondDir = join(root, "second");
    for (const outDir of [firstDir, secondDir]) {
      const result = runCli(runArgs(outDir, "0,1,3"));
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

test("world-state checkpoint validation fails closed", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-world-state-checkpoint-invalid-"));
  try {
    const invalid = [
      ["", /non-empty comma-separated list/],
      ["0,1,1", /must not contain duplicate tick 1/],
      ["0,2,1", /must be strictly ascending/],
      ["0,-1", /non-negative integers/],
      ["0,1.5", /non-negative integers/],
      ["0,4", /cannot exceed --ticks 3/],
    ];
    for (const [index, [value, pattern]] of invalid.entries()) {
      const result = runCli(runArgs(join(root, `invalid-${index}`), value));
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
// - checkpoint writes propagate an injected host persistence failure without emitting a partial success
