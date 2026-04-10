const test = require("node:test");
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

function makeTempDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function createMeta(overrides = {}) {
  return {
    id: overrides.id || "artifact_test",
    runId: overrides.runId || "run_narrate",
    createdAt: overrides.createdAt || "2026-01-01T00:00:00.000Z",
    producedBy: overrides.producedBy || "test",
  };
}

test("cli narrate writes a turn-by-turn narrative artifact", () => {
  const workDir = makeTempDir("agent-kernel-narrate-");
  const initialStatePath = join(workDir, "initial-state.json");
  const tickFramesPath = join(workDir, "tick-frames.json");
  const outDir = join(workDir, "narrate-out");

  const initialState = {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: createMeta({ id: "initial_state" }),
    simConfigRef: {
      id: "sim_config",
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
    },
    actors: [
      { id: "actor_1", kind: "ambulatory", archetype: "delver" },
      { id: "actor_2", kind: "stationary", archetype: "warden" },
    ],
  };

  const telemetryEffect = {
    schema: "agent-kernel/Effect",
    schemaVersion: 1,
    id: "effect_1",
    tick: 1,
    fulfillment: "deterministic",
    kind: "telemetry",
    personaRef: "annotator",
    data: { metric: "steps" },
  };

  const tickFrames = [
    {
      schema: "agent-kernel/TickFrame",
      schemaVersion: 1,
      meta: createMeta({ id: "frame_1", producedBy: "moderator" }),
      tick: 1,
      phase: "execute",
      phaseDetail: "apply",
      acceptedActions: [
        {
          schema: "agent-kernel/Action",
          schemaVersion: 1,
          actorId: "actor_1",
          tick: 1,
          kind: "move",
          params: { x: 1, y: 0 },
        },
      ],
      emittedEvents: [
        {
          schema: "agent-kernel/Event",
          schemaVersion: 1,
          tick: 1,
          kind: "actor_moved",
          actorId: "actor_1",
          data: { to: { x: 1, y: 0 } },
        },
      ],
      emittedEffects: [telemetryEffect],
      fulfilledEffects: [
        {
          effect: telemetryEffect,
          status: "fulfilled",
          result: { persisted: true },
        },
      ],
    },
    {
      schema: "agent-kernel/TickFrame",
      schemaVersion: 1,
      meta: createMeta({ id: "frame_2", producedBy: "moderator" }),
      tick: 2,
      phase: "execute",
      phaseDetail: "apply",
      acceptedActions: [
        {
          schema: "agent-kernel/Action",
          schemaVersion: 1,
          actorId: "actor_2",
          tick: 2,
          kind: "wait",
          params: { reason: "guard" },
        },
      ],
      preCoreRejections: [
        {
          action: {
            schema: "agent-kernel/Action",
            schemaVersion: 1,
            actorId: "actor_1",
            tick: 2,
            kind: "move",
            params: { x: 1, y: 1 },
          },
          reason: "occupied",
          deferred: false,
        },
      ],
      emittedEvents: [
        {
          schema: "agent-kernel/Event",
          schemaVersion: 1,
          tick: 2,
          kind: "actor_blocked",
          actorId: "actor_1",
          data: { reason: "occupied" },
        },
      ],
    },
  ];

  writeJson(initialStatePath, initialState);
  writeJson(tickFramesPath, tickFrames);

  const result = runCli([
    "narrate",
    "--tick-frames",
    tickFramesPath,
    "--initial-state",
    initialStatePath,
    "--out-dir",
    outDir,
  ]);

  const stdout = JSON.parse(result.stdout.trim());
  assert.equal(stdout.command, "narrate");
  assert.equal(stdout.artifactPaths.narrative, join(outDir, "narrative.json"));
  assert.ok(existsSync(stdout.artifactPaths.narrative));

  const narrative = readJson(join(outDir, "narrative.json"));
  assert.equal(narrative.schema, "agent-kernel/NarrativeArtifact");
  assert.equal(narrative.schemaVersion, 1);
  assert.equal(narrative.source.frames, 2);
  assert.equal(narrative.source.ticks, 2);
  assert.equal(narrative.cast.length, 2);
  assert.equal(narrative.turns.length, 2);
  assert.match(narrative.turns[0].summary, /1 action, 1 event, 2 effects/);
  assert.match(narrative.story, /Turn 1:/);
  assert.match(narrative.story, /delver actor_1 chose move/);
  assert.match(narrative.story, /warden actor_2 chose wait/);
  assert.match(narrative.story, /delver actor_1 was blocked/);
});
