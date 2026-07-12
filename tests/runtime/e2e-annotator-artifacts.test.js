const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
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
  // Updated 2026-07-10: hazard coordinates adjudicated as room-relative (M3); formerly pinned grid-absolute semantics.
  // Build input hazards come from the affinity fixture's authored room-relative coords — the sim-config
  // fixture now stores the MAPPED absolute coords, so reusing its hazards as build input would
  // double-shift them out of the room. The expected summary position/sourceId are derived below by
  // the mapping arithmetic (rooms[0] origin + authored offset) instead of the fixture's literal
  // (2,2), which remains correct for the direct-resolution consumers of the shared fixture.
  const presets = readJson(resolve(ROOT, "tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json"));
  const loadouts = readJson(resolve(ROOT, "tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json"));
  const simConfig = readJson(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-hazard.json"));
  const initialState = readJson(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json"));
  const affinityFixture = readJson(resolve(ROOT, "tests/fixtures/personas/affinity-resolution-v1-basic.json"));
  const expected = affinityFixture.expected;

  const { orchestrateBuild } = await import(
    "../../packages/runtime/src/build/orchestrate-build.js"
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
          hazards: affinityFixture.input.hazards,
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

  // Room-relative mapping arithmetic: the authored hazard offset lands at rooms[0] origin + offset.
  const room = buildResult.simConfig.layout.data.rooms[0];
  assert.ok(room, "build layout must declare rooms for hazard mapping");
  const expectedHazards = expected.hazards.map((hazard, index) => {
    const authored = affinityFixture.input.hazards[index];
    const mapped = { x: room.x + authored.x, y: room.y + authored.y };
    return {
      ...hazard,
      position: mapped,
      resolvedEffects: hazard.resolvedEffects.map((effect) => ({
        ...effect,
        sourceId: `${mapped.x},${mapped.y}`,
      })),
    };
  });
  assert.deepEqual(summary.hazards, expectedHazards);
});
