const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toRef(artifact, fallbackSchema) {
  return {
    id: artifact?.meta?.id || "unknown",
    schema: artifact?.schema || fallbackSchema,
    schemaVersion: artifact?.schemaVersion || 1,
  };
}

test("annotator affinity summary artifacts are deterministic and schema-valid", async () => {
  const presets = readJson(resolve(ROOT, "tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json"));
  const loadouts = readJson(resolve(ROOT, "tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json"));
  const simConfig = readJson(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json"));
  const initialState = readJson(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json"));
  const expected = readJson(resolve(ROOT, "tests/fixtures/personas/affinity-resolution-v1-basic.json")).expected;

  const { orchestrateBuild } = await import(
    moduleUrl("packages/runtime/src/build/orchestrate-build.js")
  );

  const runId = "run_affinity_e2e";
  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "spec_affinity_e2e",
      runId,
      createdAt: "2025-01-01T00:00:00.000Z",
      source: "e2e-test",
    },
    intent: {
      goal: "Annotator affinity summary e2e",
    },
    configurator: {
      inputs: {
        levelGen: {
          width: simConfig.layout.data.width,
          height: simConfig.layout.data.height,
          seed: simConfig.seed,
          shape: { profile: "rectangular" },
          traps: simConfig.layout.data.traps,
        },
        actors: initialState.actors,
        affinityPresets: presets,
        affinityLoadouts: loadouts,
      },
    },
  };

  const buildResult = await orchestrateBuild({ spec, producedBy: "runtime-build" });
  assert.ok(buildResult.affinitySummary);

  const summary = buildResult.affinitySummary;
  assert.equal(summary.schema, "agent-kernel/AffinitySummary");
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.meta.runId, runId);
  assert.deepEqual(summary.presetsRef, toRef(presets, "agent-kernel/AffinityPresetArtifact"));
  assert.deepEqual(summary.loadoutsRef, toRef(loadouts, "agent-kernel/ActorLoadoutArtifact"));
  assert.deepEqual(summary.actors, expected.actors);
  assert.deepEqual(summary.traps, expected.traps);
});
