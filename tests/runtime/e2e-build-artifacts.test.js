const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function addManifestEntry(entries, artifact, path) {
  if (!artifact || !artifact.meta?.id) return;
  entries.push({
    id: artifact.meta.id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
    path,
  });
}

function buildArtifactRefs(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    schema: entry.schema,
    schemaVersion: entry.schemaVersion,
  }));
}

test("orchestrated build produces deterministic bundle/manifest/telemetry outputs", async () => {
  const scenario = readJson(resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json"));
  const summaryFixture = readJson(resolve(ROOT, scenario.summaryPath));
  const catalog = readJson(resolve(ROOT, scenario.catalogPath));
  const budgetFixture = readJson(resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"));
  const priceListFixture = readJson(resolve(ROOT, "tests/fixtures/allocator/price-list-v1-basic.json"));

  const { normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );
  const { orchestrateBuild } = await import(
    moduleUrl("packages/runtime/src/build/orchestrate-build.js")
  );
  const { buildLlmCaptureArtifact } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/llm-capture.js")
  );
  const { buildBuildTelemetryRecord } = await import(
    moduleUrl("packages/runtime/src/build/telemetry.js")
  );
  const { filterSchemaCatalogEntries } = await import(
    moduleUrl("packages/runtime/src/contracts/schema-catalog.js")
  );

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const buildSpecResult = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "run_e2e_build",
    createdAt: "2025-01-01T00:00:00Z",
    source: "e2e-test",
    budgetArtifact: budgetFixture,
    priceListArtifact: priceListFixture,
  });
  assert.equal(buildSpecResult.ok, true);

  const captureResult = buildLlmCaptureArtifact({
    prompt: "Fixture LLM prompt.",
    responseText: JSON.stringify(summaryFixture),
    responseParsed: summaryFixture,
    summary: normalized.value,
    model: "fixture",
    baseUrl: "http://localhost:11434",
    runId: buildSpecResult.spec.meta.runId,
    producedBy: "orchestrator",
    clock: () => buildSpecResult.spec.meta.createdAt,
  });
  assert.equal(captureResult.errors, undefined);

  const inputs = buildSpecResult.spec.configurator?.inputs;
  if (inputs) {
    const presetId = "affinity_fire_push";
    const presetsArtifact = {
      schema: "agent-kernel/AffinityPresetArtifact",
      schemaVersion: 1,
      meta: {
        id: "affinity_presets_e2e",
        runId: buildSpecResult.spec.meta.runId,
        createdAt: buildSpecResult.spec.meta.createdAt,
        producedBy: "fixture",
      },
      presets: [
        {
          id: presetId,
          kind: "fire",
          expression: "push",
          manaCost: 0,
          effects: {
            attack: { id: "fire_push", potency: 1 },
          },
          stack: { max: 3, scaling: "linear" },
        },
      ],
    };
    const loadoutsArtifact = {
      schema: "agent-kernel/ActorLoadoutArtifact",
      schemaVersion: 1,
      meta: {
        id: "affinity_loadouts_e2e",
        runId: buildSpecResult.spec.meta.runId,
        createdAt: buildSpecResult.spec.meta.createdAt,
        producedBy: "fixture",
      },
      loadouts: (Array.isArray(inputs.actors) ? inputs.actors : []).map((actor) => ({
        actorId: actor.id,
        affinities: [
          {
            presetId,
            kind: "fire",
            expression: "push",
            stacks: 1,
          },
        ],
      })),
    };
    inputs.affinityPresets = presetsArtifact;
    inputs.affinityLoadouts = loadoutsArtifact;
    if (inputs.levelGen && typeof inputs.levelGen === "object") {
      inputs.levelGen.traps = [
        {
          x: 1,
          y: 1,
          blocking: false,
          affinity: { kind: "fire", expression: "push", stacks: 1 },
          vitals: {
            mana: { current: 1, max: 1, regen: 0 },
            durability: { current: 1, max: 1, regen: 0 },
          },
        },
      ];
    }
  }

  const buildResult = await orchestrateBuild({
    spec: buildSpecResult.spec,
    producedBy: "runtime-build",
    capturedInputs: [captureResult.capture],
  });
  assert.ok(buildResult.intent);
  assert.ok(buildResult.plan);
  assert.ok(buildResult.spendProposal);
  assert.ok(buildResult.budgetReceipt);
  assert.ok(buildResult.affinitySummary);
  assert.ok(buildResult.simConfig);
  assert.ok(buildResult.initialState);
  assert.equal(buildResult.capturedInputs?.length, 1);
  const captureArtifact = buildResult.capturedInputs[0];

  const manifestEntries = [];
  addManifestEntry(manifestEntries, buildResult.intent, "intent.json");
  addManifestEntry(manifestEntries, buildResult.plan, "plan.json");
  addManifestEntry(manifestEntries, buildResult.budget?.budget, "budget.json");
  addManifestEntry(manifestEntries, buildResult.budget?.priceList, "price-list.json");
  addManifestEntry(manifestEntries, buildResult.spendProposal, "spend-proposal.json");
  addManifestEntry(manifestEntries, buildResult.budgetReceipt, "budget-receipt.json");
  addManifestEntry(manifestEntries, buildResult.affinitySummary, "affinity-summary.json");
  addManifestEntry(manifestEntries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(manifestEntries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(manifestEntries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(manifestEntries, buildResult.initialState, "initial-state.json");
  addManifestEntry(manifestEntries, captureArtifact, "captured-input-llm-1.json");

  manifestEntries.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.id.localeCompare(b.id);
    }
    return a.schema.localeCompare(b.schema);
  });

  const schemaEntries = filterSchemaCatalogEntries({
    schemaRefs: [
      { schema: buildSpecResult.spec.schema, schemaVersion: buildSpecResult.spec.schemaVersion },
      ...manifestEntries,
    ],
  });

  const manifest = {
    specPath: "spec.json",
    correlation: {
      runId: buildSpecResult.spec.meta.runId,
      source: buildSpecResult.spec.meta.source,
    },
    schemas: schemaEntries,
    artifacts: manifestEntries,
  };

  const bundleArtifacts = [
    buildResult.intent,
    buildResult.plan,
    buildResult.budget?.budget,
    buildResult.budget?.priceList,
    buildResult.spendProposal,
    buildResult.budgetReceipt,
    buildResult.affinitySummary,
    buildResult.solverRequest,
    buildResult.solverResult,
    buildResult.simConfig,
    buildResult.initialState,
    captureArtifact,
  ].filter(Boolean);

  bundleArtifacts.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.meta.id.localeCompare(b.meta.id);
    }
    return a.schema.localeCompare(b.schema);
  });

  const bundle = {
    spec: buildSpecResult.spec,
    schemas: schemaEntries,
    artifacts: bundleArtifacts,
  };

  const telemetry = buildBuildTelemetryRecord({
    spec: buildSpecResult.spec,
    status: "success",
    artifactRefs: buildArtifactRefs(manifestEntries),
    producedBy: "runtime-build",
    clock: () => buildSpecResult.spec.meta.createdAt,
  });

  assert.equal(bundle.spec.schema, "agent-kernel/BuildSpec");
  assert.equal(bundle.artifacts.length, manifest.artifacts.length);
  assert.equal(telemetry.schema, "agent-kernel/TelemetryRecord");
  assert.equal(telemetry.scope, "run");
  assert.equal(telemetry.data.status, "success");
  assert.equal(telemetry.meta.runId, buildSpecResult.spec.meta.runId);
  assert.deepEqual(telemetry.data.artifactRefs, buildArtifactRefs(manifestEntries));

  const requiredSchemas = new Set(["agent-kernel/IntentEnvelope", "agent-kernel/PlanArtifact"]);
  const manifestSchemas = new Set(manifest.artifacts.map((entry) => entry.schema));
  requiredSchemas.forEach((schema) => assert.ok(manifestSchemas.has(schema)));
  assert.ok(manifestSchemas.has("agent-kernel/CapturedInputArtifact"));

  const sortedManifest = [...manifest.artifacts].sort((a, b) => {
    if (a.schema === b.schema) {
      return a.id.localeCompare(b.id);
    }
    return a.schema.localeCompare(b.schema);
  });
  assert.deepEqual(manifest.artifacts, sortedManifest);

  const sortedBundle = [...bundle.artifacts].sort((a, b) => {
    if (a.schema === b.schema) {
      return a.meta.id.localeCompare(b.meta.id);
    }
    return a.schema.localeCompare(b.schema);
  });
  assert.deepEqual(bundle.artifacts, sortedBundle);

  const schemaNames = manifest.schemas.map((entry) => entry.schema);
  const sortedSchemaNames = [...schemaNames].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(schemaNames, sortedSchemaNames);
});
