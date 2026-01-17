import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { wireBundleReview } from "../../packages/ui-web/src/bundle-review.js";
import { setupPlayback } from "../../packages/ui-web/src/movement-ui.js";
import { buildBuildSpecFromSummary } from "../../packages/runtime/src/personas/director/buildspec-assembler.js";
import { mapSummaryToPool } from "../../packages/runtime/src/personas/director/pool-mapper.js";
import { normalizeSummary } from "../../packages/runtime/src/personas/orchestrator/prompt-contract.js";
import { filterSchemaCatalogEntries } from "../../packages/runtime/src/contracts/schema-catalog.js";
import { orchestrateBuild } from "../../packages/runtime/src/build/orchestrate-build.js";
import { initializeCoreFromArtifacts } from "../../packages/runtime/src/runner/core-setup.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.resolve(root, relativePath), "utf8"));
}

function makeElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    className: "",
    hidden: false,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set: (value) => {
      text = String(value);
      if (text === "") {
        el.children = [];
      }
    },
  });
  return el;
}

function makeInput(value = "") {
  const handlers = {};
  return {
    value,
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    dispatch(event) {
      handlers[event]?.();
    },
  };
}

function makeButton() {
  const handlers = {};
  return {
    disabled: false,
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      return handlers.click?.();
    },
  };
}

function makeDisplayElement() {
  return { textContent: "", disabled: false };
}

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function addManifestEntry(entries, artifact, entryPath) {
  if (!artifact?.meta?.id) return;
  entries.push({
    id: artifact.meta.id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
    path: entryPath,
  });
}

function createStubCore() {
  const state = {
    width: 1,
    height: 1,
    grid: [[1]],
    actor: { x: 0, y: 0, kind: 2, vitals: [] },
    tick: 0,
  };

  function tileChar(x, y) {
    const code = state.grid[y]?.[x] ?? 0;
    if (code === 2) return "S";
    if (code === 3) return "E";
    if (code === 4) return "B";
    if (code === 1) return ".";
    return "#";
  }

  return {
    init() {
      state.tick = 0;
    },
    configureGrid(width, height) {
      state.width = width;
      state.height = height;
      state.grid = Array.from({ length: height }, () => Array.from({ length: width }, () => 1));
      return 0;
    },
    setTileAt(x, y, value) {
      if (state.grid[y]) state.grid[y][x] = value;
    },
    spawnActorAt(x, y) {
      state.actor.x = x;
      state.actor.y = y;
    },
    setActorVital(index, current, max, regen) {
      state.actor.vitals[index] = { current, max, regen };
    },
    getMapWidth() {
      return state.width;
    },
    getMapHeight() {
      return state.height;
    },
    renderBaseCellChar(x, y) {
      return tileChar(x, y).charCodeAt(0);
    },
    renderCellChar(x, y) {
      return tileChar(x, y).charCodeAt(0);
    },
    getActorX() {
      return state.actor.x;
    },
    getActorY() {
      return state.actor.y;
    },
    getActorKind() {
      return state.actor.kind;
    },
    getActorVitalCurrent(index) {
      return state.actor.vitals[index]?.current ?? 0;
    },
    getActorVitalMax(index) {
      return state.actor.vitals[index]?.max ?? 0;
    },
    getActorVitalRegen(index) {
      return state.actor.vitals[index]?.regen ?? 0;
    },
    getTileActorKind() {
      return 0;
    },
    getTileActorCount() {
      return 0;
    },
    getCurrentTick() {
      return state.tick;
    },
    clearEffects() {},
  };
}

function sortArtifactsBySchemaAndId(items) {
  items.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.meta.id.localeCompare(b.meta.id);
    }
    return a.schema.localeCompare(b.schema);
  });
}

function sortManifestEntries(entries) {
  entries.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.id.localeCompare(b.id);
    }
    return a.schema.localeCompare(b.schema);
  });
}

test("bundle review and playback load from orchestrated build outputs", async () => {
  const scenario = readJson("tests/fixtures/e2e/e2e-scenario-v1-basic.json");
  const summaryFixture = readJson(scenario.summaryPath);
  const catalog = readJson(scenario.catalogPath);

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const buildSpecResult = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "run_ui_bundle",
    createdAt: "2025-01-01T00:00:00Z",
    source: "ui-test",
  });
  assert.equal(buildSpecResult.ok, true);

  const buildResult = await orchestrateBuild({ spec: buildSpecResult.spec, producedBy: "runtime-build" });
  assert.ok(buildResult.simConfig);
  assert.ok(buildResult.initialState);

  const manifestEntries = [];
  addManifestEntry(manifestEntries, buildResult.intent, "intent.json");
  addManifestEntry(manifestEntries, buildResult.plan, "plan.json");
  addManifestEntry(manifestEntries, buildResult.budget?.budget, "budget.json");
  addManifestEntry(manifestEntries, buildResult.budget?.priceList, "price-list.json");
  addManifestEntry(manifestEntries, buildResult.budgetReceipt, "budget-receipt.json");
  addManifestEntry(manifestEntries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(manifestEntries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(manifestEntries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(manifestEntries, buildResult.initialState, "initial-state.json");
  sortManifestEntries(manifestEntries);

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
    buildResult.budgetReceipt,
    buildResult.solverRequest,
    buildResult.solverResult,
    buildResult.simConfig,
    buildResult.initialState,
  ].filter(Boolean);

  sortArtifactsBySchemaAndId(bundleArtifacts);

  const bundle = {
    spec: buildSpecResult.spec,
    schemas: schemaEntries,
    artifacts: bundleArtifacts,
  };

  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;

  globalThis.document = {
    createElement: (tag) => makeElement(tag),
  };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();

  try {
    globalThis.sessionStorage.setItem(
      "ak.build.last.session",
      JSON.stringify({
        runId: buildSpecResult.spec.meta.runId,
        specPath: "spec.json",
        outDir: "",
        savedAt: buildSpecResult.spec.meta.createdAt,
        response: { bundle, manifest },
      }),
    );

    const bundleStatus = { textContent: "" };
    const schemaList = makeElement("ul");
    const manifestOutput = { textContent: "" };
    const specTextarea = makeInput("");
    const specErrors = makeElement("ul");
    const intentOutput = { textContent: "" };
    const planOutput = { textContent: "" };
    const configuratorOutput = { textContent: "" };
    const artifactsContainer = makeElement("div");

    const playbackElements = {
      frame: makeDisplayElement(),
      baseTiles: makeDisplayElement(),
      actorId: makeDisplayElement(),
      actorPos: makeDisplayElement(),
      actorHp: makeDisplayElement(),
      tick: makeDisplayElement(),
      status: makeDisplayElement(),
      playButton: makeDisplayElement(),
      stepBack: makeDisplayElement(),
      stepForward: makeDisplayElement(),
      reset: makeDisplayElement(),
    };

    const loadLastButton = makeButton();
    const runButton = makeButton();

    wireBundleReview({
      elements: {
        bundleInput: makeInput(""),
        manifestInput: makeInput(""),
        loadLastButton,
        runButton,
        clearButton: makeButton(),
        statusEl: bundleStatus,
        schemaList,
        manifestOutput,
        specTextarea,
        specErrors,
        applySpecButton: makeButton(),
        sendSpecButton: makeButton(),
        downloadSpecButton: makeButton(),
        intentOutput,
        planOutput,
        configuratorOutput,
        artifactsContainer,
      },
      onRun: ({ simConfig, initialState }) => {
        const core = createStubCore();
        setupPlayback({
          core,
          actions: [],
          elements: playbackElements,
          initCore: () => {
            core.init();
            const { layout, actor } = initializeCoreFromArtifacts(core, { simConfig, initialState });
            if (!layout.ok) throw new Error(layout.reason);
            if (!actor.ok) throw new Error(actor.reason);
          },
        });
      },
    });

    loadLastButton.click();
    assert.match(bundleStatus.textContent, /Loaded bundle/);
    assert.equal(schemaList.children.length > 0, true);
    assert.equal(artifactsContainer.children.length, bundle.artifacts.length);

    runButton.click();
    assert.match(bundleStatus.textContent, /Loaded artifacts into Runtime controls/);

    assert.ok(playbackElements.frame.textContent.length > 0);
    assert.equal(playbackElements.tick.textContent, "0");
    assert.match(playbackElements.status.textContent, /Out of actions|Ready|Reached exit/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});
