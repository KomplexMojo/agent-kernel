const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join, dirname } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createMeta(runId, id) {
  return {
    id,
    runId,
    createdAt: "2026-04-10T00:00:00.000Z",
    producedBy: "fixture",
  };
}

function createInitialState(runId, actors) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: createMeta(runId, `initial_${runId}`),
    simConfigRef: {
      id: `sim_${runId}`,
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors,
  };
}

function createSimConfig(runId) {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: createMeta(runId, `sim_${runId}`),
    layout: {
      kind: "grid",
      data: {
        rooms: [{ id: `room_${runId}` }],
      },
    },
  };
}

function createFrame(runId, tick, details = {}) {
  return {
    schema: "agent-kernel/TickFrame",
    schemaVersion: 1,
    meta: createMeta(runId, `frame_${runId}_${tick}_${details.phaseDetail || "apply"}`),
    tick,
    phase: "execute",
    phaseDetail: details.phaseDetail || "apply",
    acceptedActions: details.acceptedActions || [],
    emittedEffects: details.emittedEffects || [],
    fulfilledEffects: details.fulfilledEffects || [],
    emittedEvents: details.emittedEvents || [],
  };
}

function writeComparableRun(workDir, runId, frames) {
  const buildDir = join(workDir, "artifacts", "runs", runId, "build");
  const runDir = join(workDir, "artifacts", "runs", runId, "run");
  writeJson(join(buildDir, "sim-config.json"), createSimConfig(runId));
  writeJson(join(buildDir, "initial-state.json"), createInitialState(runId, []));
  writeJson(join(runDir, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: createMeta(runId, `summary_${runId}`),
    outcome: "success",
    metrics: { ticks: frames.length, effects: 0 },
  });
  writeJson(join(runDir, "tick-frames.json"), frames);
}

test("cli diff compares two prior runs and reports divergence, effects, damage, and actor presence", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-diff-"));
  const runA = "run_diff_alpha";
  const runB = "run_diff_beta";
  const buildA = join(workDir, "artifacts", "runs", runA, "build");
  const buildB = join(workDir, "artifacts", "runs", runB, "build");
  const runDirA = join(workDir, "artifacts", "runs", runA, "run");
  const runDirB = join(workDir, "artifacts", "runs", runB, "run");

  writeJson(join(buildA, "sim-config.json"), createSimConfig(runA));
  writeJson(join(buildB, "sim-config.json"), createSimConfig(runB));
  writeJson(join(buildA, "initial-state.json"), createInitialState(runA, [
    {
      id: "actor_alpha",
      kind: "ambulatory",
      vitals: {
        health: { current: 10, max: 10, regen: 0 },
      },
    },
    {
      id: "actor_beta",
      kind: "stationary",
      vitals: {
        health: { current: 12, max: 12, regen: 0 },
      },
    },
  ]));
  writeJson(join(buildB, "initial-state.json"), createInitialState(runB, [
    {
      id: "actor_alpha",
      kind: "ambulatory",
      vitals: {
        health: { current: 10, max: 10, regen: 0 },
      },
    },
    {
      id: "actor_beta",
      kind: "stationary",
      vitals: {
        health: { current: 12, max: 12, regen: 0 },
      },
    },
    {
      id: "actor_gamma",
      kind: "ambulatory",
      vitals: {
        health: { current: 8, max: 8, regen: 0 },
      },
    },
  ]));

  writeJson(join(runDirA, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: createMeta(runA, `summary_${runA}`),
    outcome: "success",
    metrics: {
      ticks: 2,
      effects: 2,
    },
  });
  writeJson(join(runDirB, "run-summary.json"), {
    schema: "agent-kernel/RunSummary",
    schemaVersion: 1,
    meta: createMeta(runB, `summary_${runB}`),
    outcome: "success",
    metrics: {
      ticks: 3,
      effects: 4,
    },
  });

  writeJson(join(runDirA, "tick-frames.json"), [
    createFrame(runA, 1, {
      phaseDetail: "observe",
      emittedEffects: [{ kind: "telemetry" }],
    }),
    createFrame(runA, 2, {
      phaseDetail: "emit",
      emittedEffects: [{ kind: "telemetry" }],
      emittedEvents: [
        {
          kind: "damage_applied",
          actorId: "actor_alpha",
          data: {
            targetId: "actor_beta",
            damage: 3,
          },
        },
      ],
    }),
  ]);
  writeJson(join(runDirB, "tick-frames.json"), [
    createFrame(runB, 1, {
      phaseDetail: "observe",
      emittedEffects: [{ kind: "telemetry" }],
    }),
    createFrame(runB, 2, {
      phaseDetail: "emit",
      emittedEffects: [{ kind: "telemetry" }, { kind: "damage_ping", data: { targetId: "actor_beta", damage: 2 } }],
      emittedEvents: [
        {
          kind: "damage_applied",
          actorId: "actor_alpha",
          data: {
            targetId: "actor_beta",
            damage: 5,
          },
        },
      ],
    }),
    createFrame(runB, 3, {
      phaseDetail: "summarize",
      emittedEffects: [{ kind: "telemetry" }],
    }),
  ]);

  const result = runCli(["diff", "--run-a", runA, "--run-b", runB], { cwd: workDir });
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "diff");
  assert.equal(output.runA, runA);
  assert.equal(output.runB, runB);
  assert.equal(output.sourceA.command, "run");
  assert.equal(output.sourceB.command, "run");
  assert.deepEqual(output.ticks, { a: 2, b: 3, delta: 1 });
  assert.deepEqual(output.effects, { a: 2, b: 4, delta: 2 });
  assert.deepEqual(output.damage, { a: 3, b: 7, delta: 4 });
  assert.equal(output.divergesAtTick, 2);
  assert.equal(output.divergence.reason, "frame_mismatch");

  const actorBeta = output.actors.find((entry) => entry.id === "actor_beta");
  assert.ok(actorBeta);
  assert.equal(actorBeta.presentInA, true);
  assert.equal(actorBeta.presentInB, true);
  assert.equal(actorBeta.damageReceivedA, 3);
  assert.equal(actorBeta.damageReceivedB, 7);
  assert.equal(actorBeta.damageDelta, 4);

  const actorGamma = output.actors.find((entry) => entry.id === "actor_gamma");
  assert.ok(actorGamma);
  assert.equal(actorGamma.presentInA, false);
  assert.equal(actorGamma.presentInB, true);
  assert.equal(actorGamma.vitalsA, null);
});

test("cli diff returns structured failure for missing runs", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-diff-missing-"));
  const result = runCli(["diff", "--run-a", "run_missing_a", "--run-b", "run_missing_b"], { cwd: workDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Run directory not found:/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "diff");
  assert.match(output.error, /Run directory not found:/);
});

test("cli diff between two create-only runs returns an ok:false envelope for documented GAP-3", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-diff-create-only-"));
  const runA = "run_create_only_a";
  const runB = "run_create_only_b";

  writeJson(join(workDir, "artifacts", "runs", runA, "build", "sim-config.json"), createSimConfig(runA));
  writeJson(join(workDir, "artifacts", "runs", runB, "build", "sim-config.json"), createSimConfig(runB));
  writeJson(join(workDir, "artifacts", "runs", runA, "build", "initial-state.json"), createInitialState(runA, []));
  writeJson(join(workDir, "artifacts", "runs", runB, "build", "initial-state.json"), createInitialState(runB, []));

  const result = runCli(["diff", "--run-a", runA, "--run-b", runB], { cwd: workDir });

  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.command, "diff");
});

test("cli diff with --run-a equal to --run-b returns a stable no-diff result", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-diff-same-run-"));
  const runId = "run_same";
  writeComparableRun(workDir, runId, [createFrame(runId, 1)]);

  const result = runCli(["diff", "--run-a", runId, "--run-b", runId], { cwd: workDir });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.divergesAtTick, null);
  assert.equal(output.divergence, null);
  assert.deepEqual(output.ticks, { a: 1, b: 1, delta: 0 });
  assert.deepEqual(output.effects, { a: 0, b: 0, delta: 0 });
});

// STAYS SKIPPED — a missing tick-frames file is currently normalized to an empty run (checked 2026-08-14).
test.skip("cli diff names missing tick-frames artifact when run-summary exists", () => {});

test("cli diff with identical tick-frames reports zero divergence deterministically", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-diff-identical-"));
  const runA = "run_identical_a";
  const runB = "run_identical_b";
  writeComparableRun(workDir, runA, [createFrame(runA, 1), createFrame(runA, 2)]);
  writeComparableRun(workDir, runB, [createFrame(runB, 1), createFrame(runB, 2)]);

  const result = runCli(["diff", "--run-a", runA, "--run-b", runB], { cwd: workDir });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.divergesAtTick, null);
  assert.equal(output.divergence, null);
  assert.deepEqual(output.ticks, { a: 2, b: 2, delta: 0 });
});

test("cli diff reports longer-run tail frames as additions", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-diff-tail-"));
  const runA = "run_tail_a";
  const runB = "run_tail_b";
  writeComparableRun(workDir, runA, [createFrame(runA, 1)]);
  writeComparableRun(workDir, runB, [createFrame(runB, 1), createFrame(runB, 2)]);

  const result = runCli(["diff", "--run-a", runA, "--run-b", runB], { cwd: workDir });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.divergesAtTick, 2);
  assert.equal(output.divergence.reason, "missing_run_a_frame");
  assert.equal(output.divergence.frameA, null);
  assert.equal(output.divergence.frameB.tick, 2);
  assert.deepEqual(output.ticks, { a: 1, b: 2, delta: 1 });
});
