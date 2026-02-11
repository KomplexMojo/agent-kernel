import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { wireBundleReview } from "../../packages/ui-web/src/bundle-review.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

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

test("bundle review passes affinity summary payload to runtime callback", () => {
  const fixture = JSON.parse(readFileSync(path.join(root, "tests/fixtures/ui/build-spec-bundle/bundle.json"), "utf8"));
  const affinitySummary = {
    schema: "agent-kernel/AffinitySummary",
    schemaVersion: 1,
    meta: {
      id: "affinity_summary_test",
      runId: fixture.spec.meta.runId,
      createdAt: fixture.spec.meta.createdAt,
      producedBy: "annotator",
    },
    actors: [
      {
        actorId: fixture.artifacts.find((artifact) => artifact.schema === "agent-kernel/InitialStateArtifact")
          ?.actors?.[0]?.id || "actor_bundle",
        affinityStacks: { "fire:push": 2 },
      },
    ],
    traps: [{ position: { x: 2, y: 2 }, affinityStacks: { "fire:push": 1 } }],
  };
  fixture.artifacts.push(affinitySummary);

  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;

  globalThis.document = {
    createElement: (tag) => makeElement(tag),
  };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();

  let runPayload = null;
  try {
    globalThis.sessionStorage.setItem(
      "ak.build.last.session",
      JSON.stringify({
        response: { bundle: fixture },
      }),
    );

    const loadLastButton = makeButton();
    const runButton = makeButton();
    wireBundleReview({
      elements: {
        bundleInput: makeInput(""),
        manifestInput: makeInput(""),
        loadLastButton,
        runButton,
        clearButton: makeButton(),
        statusEl: { textContent: "" },
        schemaList: makeElement("ul"),
        manifestOutput: { textContent: "" },
        specTextarea: makeInput(""),
        specErrors: makeElement("ul"),
        applySpecButton: makeButton(),
        sendSpecButton: makeButton(),
        downloadSpecButton: makeButton(),
        intentOutput: { textContent: "" },
        planOutput: { textContent: "" },
        configuratorOutput: { textContent: "" },
        artifactsContainer: makeElement("div"),
      },
      onRun: (payload) => {
        runPayload = payload;
      },
    });

    runButton.click();

    assert.ok(runPayload);
    assert.ok(runPayload.simConfig);
    assert.ok(runPayload.initialState);
    assert.ok(runPayload.affinityEffects);
    assert.equal(runPayload.affinityEffects.actors.length, 1);
    assert.equal(runPayload.affinityEffects.traps.length, 1);
    assert.equal(runPayload.affinityEffects.actors[0].affinityStacks["fire:push"], 2);
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});
