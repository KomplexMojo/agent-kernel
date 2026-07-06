import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { compileScenarioToBundle } from "../../packages/ui-web/src/scenario-loader.js";
// M6 target module — does not exist yet. These tests are the implementation contract.
import {
  createPhaserSurfaceIngestion,
  classifyIngestionPayload,
} from "../../packages/ui-web/src/phaser-surface-ingestion.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCENARIO_PATH = resolve(__dirname, "../fixtures/scenarios/delver-warden-battle-v1-basic.json");

function createFakeSurfaces() {
  const calls = { cardBuilder: [], gameplay: [] };
  const cardBuilder = {
    setCards(cards) { calls.cardBuilder.push({ kind: "setCards", cards }); return true; },
    async loadBuildSpec(spec) { calls.cardBuilder.push({ kind: "loadBuildSpec", spec }); return { ok: true, cards: spec?.cards || [] }; },
    loadSummary(summary) { calls.cardBuilder.push({ kind: "loadSummary", summary }); return true; },
  };
  const gameplay = {
    async loadRun(bundle) { calls.gameplay.push({ kind: "loadRun", bundle }); return true; },
    getBoardState() { return calls.gameplay.lastBoard || null; },
  };
  return { cardBuilder, gameplay, calls };
}

const BUILD_SPEC = {
  schema: "agent-kernel/BuildSpec",
  schemaVersion: 1,
  meta: { id: "bs", runId: "r", createdAt: "2026-01-01T00:00:00.000Z", source: "test" },
  intent: { goal: "g", hints: { budgetTokens: 5000 } },
  plan: { hints: { cardSet: [{ id: "w1", type: "warden", count: 1, affinity: "earth", motivations: ["defending"] }] } },
  configurator: { inputs: { cardSet: [{ id: "r1", type: "room", count: 1, affinity: "fire", roomSize: "medium" }] } },
};

test("classifyIngestionPayload distinguishes build specs, card sets, and run bundles", () => {
  assert.equal(classifyIngestionPayload(BUILD_SPEC), "build_spec");
  assert.equal(
    classifyIngestionPayload({ schema: "agent-kernel/GameplayBundle", artifacts: [], tickFrames: [] }),
    "run_bundle",
  );
  assert.equal(classifyIngestionPayload([{ id: "r1", type: "room" }]), "card_set");
  assert.equal(classifyIngestionPayload({ cardSet: [{ id: "r1", type: "room" }] }), "card_set");
  assert.equal(classifyIngestionPayload(null), "unknown");
});

test("ingestion routes a build spec to the card builder surface", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });

  const result = await ingestion.ingest(BUILD_SPEC);
  assert.equal(result.ok, true);
  assert.equal(result.surface, "card-builder");
  assert.equal(calls.gameplay.length, 0, "build spec must not touch the gameplay surface");
  assert.ok(calls.cardBuilder.some((c) => c.kind === "loadBuildSpec"));
});

test("ingestion routes a card-set payload to the card builder surface", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });

  const result = await ingestion.ingest([{ id: "r1", type: "room", roomSize: "small", affinity: "fire" }]);
  assert.equal(result.ok, true);
  assert.equal(result.surface, "card-builder");
  assert.equal(calls.gameplay.length, 0);
  assert.ok(calls.cardBuilder.some((c) => c.kind === "setCards"));
});

test("ingestion routes an existing run bundle to the gameplay surface", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });

  const scenario = JSON.parse(await readFile(SCENARIO_PATH, "utf8"));
  const bundle = await compileScenarioToBundle(scenario);
  const result = await ingestion.ingest(bundle);

  assert.equal(result.ok, true);
  assert.equal(result.surface, "gameplay");
  assert.equal(calls.cardBuilder.length, 0, "run bundle must not touch the card builder surface");
  assert.ok(calls.gameplay.some((c) => c.kind === "loadRun"));
});

test("ingestion accepts the existing gameplay artifacts without schema changes", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });

  const scenario = JSON.parse(await readFile(SCENARIO_PATH, "utf8"));
  const bundle = await compileScenarioToBundle(scenario);

  const schemas = bundle.artifacts.map((a) => a.schema);
  assert.ok(schemas.includes("agent-kernel/SimConfigArtifact"));
  assert.ok(schemas.includes("agent-kernel/InitialStateArtifact"));
  assert.ok(Array.isArray(bundle.tickFrames));

  await ingestion.ingest(bundle);
  const loadRunCall = calls.gameplay.find((c) => c.kind === "loadRun");
  assert.ok(loadRunCall, "the run bundle must be passed through to loadRun unchanged");
  assert.equal(loadRunCall.bundle, bundle);
});

test("ingestion routes a summary payload to loadSummary on the card builder surface", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });
  const summary = { rooms: [{ affinity: "fire", size: "small", count: 1 }], actors: [] };

  const result = await ingestion.ingest(summary);

  assert.deepEqual(result, { ok: true, surface: "card-builder", kind: "summary" });
  assert.equal(calls.gameplay.length, 0);
  assert.deepEqual(calls.cardBuilder, [{ kind: "loadSummary", summary }]);
});

test("ingestion returns unknown_payload for an unknown object", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });

  const result = await ingestion.ingest({ schema: "agent-kernel/UnknownArtifact", payload: {} });

  assert.deepEqual(result, { ok: false, reason: "unknown_payload", kind: "unknown" });
  assert.equal(calls.cardBuilder.length, 0);
  assert.equal(calls.gameplay.length, 0);
});

test("ingestion routes a run bundle missing tickFrames to gameplay when artifacts are valid", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });
  const bundle = {
    schema: "agent-kernel/GameplayBundle",
    artifacts: [{ schema: "agent-kernel/SimConfigArtifact", config: {} }],
  };

  const result = await ingestion.ingest(bundle);

  assert.deepEqual(result, { ok: true, surface: "gameplay", kind: "run_bundle" });
  assert.equal(calls.cardBuilder.length, 0);
  assert.equal(calls.gameplay[0].bundle, bundle);
});

test("ingestion rejects a malformed run bundle without throwing", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });

  const result = await ingestion.ingest({
    schema: "agent-kernel/GameplayBundle",
    artifacts: { schema: "agent-kernel/SimConfigArtifact" },
    tickFrames: [],
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "malformed_run_bundle",
    surface: "gameplay",
    kind: "run_bundle",
  });
  assert.equal(calls.cardBuilder.length, 0);
  assert.equal(calls.gameplay.length, 0);
});

test("ingestion preserves missing_card_set from build spec hydration", async () => {
  const { gameplay, calls } = createFakeSurfaces();
  const cardBuilder = {
    async loadBuildSpec(spec) {
      calls.cardBuilder.push({ kind: "loadBuildSpec", spec });
      return { ok: false, reason: "missing_card_set" };
    },
    setCards() {
      throw new Error("setCards should not be called for build specs");
    },
  };
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });
  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { id: "bs-empty", runId: "r", createdAt: "2026-01-01T00:00:00.000Z", source: "test" },
    intent: { goal: "empty", hints: {} },
    plan: { hints: {} },
    configurator: { inputs: {} },
  };

  const result = await ingestion.ingest(spec);

  assert.deepEqual(result, {
    ok: false,
    reason: "missing_card_set",
    surface: "card-builder",
    kind: "build_spec",
  });
  assert.equal(calls.gameplay.length, 0);
});

test("ingestion forwards run bundles with an optional ResourceBundleArtifact unchanged", async () => {
  const { cardBuilder, gameplay, calls } = createFakeSurfaces();
  const ingestion = createPhaserSurfaceIngestion({ cardBuilder, gameplay });
  const bundle = {
    schema: "agent-kernel/GameplayBundle",
    artifacts: [
      { schema: "agent-kernel/SimConfigArtifact", config: {} },
      { schema: "agent-kernel/ResourceBundleArtifact", resources: [] },
    ],
    tickFrames: [],
  };

  const result = await ingestion.ingest(bundle);

  assert.deepEqual(result, { ok: true, surface: "gameplay", kind: "run_bundle" });
  assert.equal(calls.cardBuilder.length, 0);
  assert.equal(calls.gameplay[0].bundle, bundle);
});

test("classifyIngestionPayload treats a bare rooms or actors object as a summary", () => {
  assert.equal(classifyIngestionPayload({ rooms: [] }), "summary");
  assert.equal(classifyIngestionPayload({ actors: [] }), "summary");
});

test("classifyIngestionPayload returns unknown for primitives", () => {
  assert.equal(classifyIngestionPayload("agent-kernel/GameplayBundle"), "unknown");
  assert.equal(classifyIngestionPayload(42), "unknown");
});
