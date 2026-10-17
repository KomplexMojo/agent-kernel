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
  // double-shift them out of the room. Expected AffinitySummary.hazards is [] under unified-actor
  // (hazards map to actors); actor vitals include the orchestrateBuild viability floor.
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
        // Stamp lossless categories — fixture ambulatory actors lack attacking/defending cues
        // for leftoverCategory; do not invent leftoverCategory rules for bare ambulatory.
        actors: initialState.actors.map((actor, index) => ({
          ...actor,
          category: index === 0 ? "delver" : "warden",
          motivations: index === 0 ? ["exploring"] : ["defending"],
        })),
        affinityPresets: presets,
        affinityLoadouts: loadouts,
      },
    },
  };

  const buildResult = await orchestrateBuild({ spec, producedBy: "runtime-build" });
  assert.ok(buildResult.affinitySummary);

  const summary = buildResult.affinitySummary;
  assert.equal(summary.schema, "agent-kernel/AffinitySummary");
  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.meta.runId, runId);
  assert.deepEqual(summary.presetsRef, toRef(presets, "agent-kernel/AffinityPresetArtifact"));
  assert.deepEqual(summary.loadoutsRef, toRef(loadouts, "agent-kernel/ActorLoadoutArtifact"));
  // The shared fixture describes AFFINITY RESOLUTION; this test drives orchestrateBuild, which also
  // applies the actor viability floor on top of it. Deriving the difference here rather than baking
  // it into the fixture keeps that fixture honest for its other two consumers (`cli run` and the
  // configurator affinity-effects test), which resolve affinities on already-authored actors and so
  // must NOT see floored vitals.
  const floored = expected.actors.map((actor) => ({
    ...actor,
    vitals: {
      ...actor.vitals,
      health: { current: 11, max: 12, regen: 1 },
      mana: { current: 10, max: 12, regen: 1 },
      durability: { current: 10, max: 10, regen: 1 },
      stamina: { current: 2, max: 2, regen: 2 },
    },
  }));
  floored[1].vitals = {
    ...floored[1].vitals,
    health: { current: 9, max: 10, regen: 1 },
    mana: { current: 10, max: 10, regen: 1 },
    durability: { current: 10, max: 10, regen: 1 },
    // Hazard-mapped actor keeps fixture stamina; viability floor only hits authored actors.
    stamina: { current: 0, max: 0, regen: 0 },
  };
  assert.deepEqual(summary.actors, floored);

  // Unified-actor: authored layout hazards are mapped into actors before affinity resolution, so
  // AffinitySummary.hazards stays empty; hazard effects show up on summary.actors (verified above).
  assert.deepEqual(summary.hazards, []);
});
