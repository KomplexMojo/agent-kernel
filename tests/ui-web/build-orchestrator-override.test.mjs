import assert from "node:assert/strict";
import { test } from "vitest";

import { wireBuildOrchestrator } from "../../packages/ui-web/src/build-orchestrator.js";
import {
  buildSummaryFromCardSet,
  createDesignCard,
} from "../../packages/ui-web/src/design-guidance.js";
import { buildBuildSpecFromSummary } from "../../packages/runtime/src/personas/director/buildspec-assembler.js";

// Regression for: "Setting the room size in the design tab has no effect on the
// room size in the gameplay tab." The Phaser design surface (index_c.html) feeds
// the freshly-published spec to the build orchestrator via setSpecOverride(). The
// DOM spec textarea (#build-spec-json) may still hold a STALE spec from a previous
// build. runBuild() must build the OVERRIDE, not the stale DOM textarea.

function makeInput(value = "") {
  const handlers = {};
  return {
    value,
    addEventListener(event, fn) { handlers[event] = fn; },
    dispatchEvent() {},
    dispatch(event) { handlers[event]?.(); },
  };
}

function makeButton() {
  const handlers = {};
  return {
    disabled: false,
    hidden: false,
    addEventListener(event, fn) { handlers[event] = fn; },
    click() { return handlers.click?.(); },
  };
}

function createStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

function specTextForRoom(size, runId) {
  const { summary } = buildSummaryFromCardSet({
    budgetTokens: 2500,
    cards: [createDesignCard({ id: `room_${size}`, type: "room", roomSize: size, affinity: "fire", count: 1 })],
  });
  const built = buildBuildSpecFromSummary({
    summary,
    runId,
    createdAt: "2025-01-01T00:00:00Z",
    source: "override-test",
  });
  assert.equal(built.ok, true, `spec build failed for ${size}: ${JSON.stringify(built.errors)}`);
  return { specText: JSON.stringify(built.spec, null, 2), levelGen: built.spec.configurator.inputs.levelGen };
}

test("runBuild builds the setSpecOverride spec, not a stale DOM textarea", async () => {
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.document = { createElement: () => ({ dataset: {}, appendChild() {} }) };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();

  try {
    const small = specTextForRoom("small", "run_small");
    const large = specTextForRoom("large", "run_large");
    // Sanity: the two specs really differ in grid size, else the test proves nothing.
    assert.ok(large.levelGen.width > small.levelGen.width, "fixture specs must differ in grid width");

    let builtSpecJson = null;
    const orchestrator = wireBuildOrchestrator({
      elements: {
        // Stale DOM textarea holds the SMALL spec, as it would after a prior build.
        specJsonInput: makeInput(small.specText),
        specPathInput: makeInput(""),
        outDirInput: makeInput(""),
        buildButton: makeButton(),
        loadButton: makeButton(),
        downloadButton: makeButton(),
        clearButton: makeButton(),
        statusEl: { textContent: "" },
        outputEl: { textContent: "" },
        validationList: { hidden: false, textContent: "", appendChild() {} },
      },
      adapterFactory: () => ({
        build: async ({ specJson }) => {
          builtSpecJson = specJson;
          return { bundle: { spec: specJson, artifacts: [] } };
        },
      }),
    });

    // The Phaser surface publishes the LARGE spec as an override.
    orchestrator.setSpecOverride(large.specText);
    const result = await orchestrator.runBuild();

    assert.equal(result.ok, true, `runBuild failed: ${JSON.stringify(result)}`);
    assert.ok(builtSpecJson, "adapter.build was never called");
    assert.equal(
      builtSpecJson.configurator.inputs.levelGen.width,
      large.levelGen.width,
      "build must use the override (large) grid width, not the stale DOM (small) one",
    );
    assert.equal(builtSpecJson.configurator.inputs.levelGen.height, large.levelGen.height);
    assert.equal(builtSpecJson.meta.runId, "run_large", "build must use the override spec's runId");
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});

test("the override is consumed once and does not leak into the next build", async () => {
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.document = { createElement: () => ({ dataset: {}, appendChild() {} }) };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();

  try {
    const small = specTextForRoom("small", "run_small");
    const large = specTextForRoom("large", "run_large");

    const builtWidths = [];
    const orchestrator = wireBuildOrchestrator({
      elements: {
        specJsonInput: makeInput(small.specText),
        specPathInput: makeInput(""),
        outDirInput: makeInput(""),
        buildButton: makeButton(),
        loadButton: makeButton(),
        downloadButton: makeButton(),
        clearButton: makeButton(),
        statusEl: { textContent: "" },
        outputEl: { textContent: "" },
        validationList: { hidden: false, textContent: "", appendChild() {} },
      },
      adapterFactory: () => ({
        build: async ({ specJson }) => {
          builtWidths.push(specJson.configurator.inputs.levelGen.width);
          return { bundle: { spec: specJson, artifacts: [] } };
        },
      }),
    });

    orchestrator.setSpecOverride(large.specText);
    await orchestrator.runBuild(); // uses override → large
    await orchestrator.runBuild(); // no override → falls back to DOM textarea (small)

    assert.deepEqual(builtWidths, [large.levelGen.width, small.levelGen.width]);
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});
