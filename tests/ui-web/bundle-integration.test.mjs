import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { wireBuildOrchestrator } from "../../packages/ui-web/src/build-orchestrator.js";
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

test("build response snapshot loads into bundle review panel", async () => {
  const bundle = JSON.parse(readFileSync(path.join(root, "tests/fixtures/ui/build-spec-bundle/bundle.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(root, "tests/fixtures/ui/build-spec-bundle/manifest.json"), "utf8"));
  const specText = JSON.stringify(bundle.spec, null, 2);

  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;

  globalThis.document = {
    createElement: (tag) => makeElement(tag),
  };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();

  try {
    const buildStatus = { textContent: "" };
    const buildOutput = { textContent: "" };
    const buildValidation = makeElement("ul");

    const buildRun = makeButton();
    const buildElements = {
      bridgeUrlInput: makeInput("/bridge/build"),
      specPathInput: makeInput(""),
      specJsonInput: makeInput(specText),
      outDirInput: makeInput(""),
      buildButton: buildRun,
      loadButton: makeButton(),
      downloadButton: makeButton(),
      clearButton: makeButton(),
      statusEl: buildStatus,
      outputEl: buildOutput,
      validationList: buildValidation,
    };

    wireBuildOrchestrator({
      elements: buildElements,
      adapterFactory: () => ({
        build: async () => ({ bundle, manifest }),
      }),
    });

    await buildRun.click();
    assert.match(buildStatus.textContent, /Build complete/);

    const bundleStatus = { textContent: "" };
    const schemaList = makeElement("ul");
    const manifestOutput = { textContent: "" };
    const specTextarea = makeInput("");
    const specErrors = makeElement("ul");
    const intentOutput = { textContent: "" };
    const planOutput = { textContent: "" };
    const configuratorOutput = { textContent: "" };
    const artifactsContainer = makeElement("div");

    const loadLastButton = makeButton();
    wireBundleReview({
      elements: {
        bundleInput: makeInput(""),
        manifestInput: makeInput(""),
        loadLastButton,
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
    });

    await loadLastButton.click();
    assert.match(bundleStatus.textContent, /Loaded bundle/);
    assert.equal(schemaList.children.length > 0, true);
    assert.equal(schemaList.children.some((entry) => entry.textContent.includes("agent-kernel/BuildSpec")), true);
    assert.match(manifestOutput.textContent, /specPath/);
    assert.match(specTextarea.value, /agent-kernel\/BuildSpec/);

    const intent = JSON.parse(intentOutput.textContent);
    assert.equal(intent.goal, bundle.spec.intent.goal);
    assert.equal(artifactsContainer.children.length, bundle.artifacts.length);
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});
