import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildResultHasBundle, wireBuildOrchestrator } from "../../packages/ui-web/src/build-orchestrator.js";
import { wireBundleReview } from "../../packages/ui-web/src/bundle-review.js";
import { shouldHydrateDesignFromBundleSource } from "../../packages/ui-web/src/build-spec-ui.js";
import { createDefaultResourceBundleArtifact } from "../../packages/runtime/src/render/resource-bundle.js";

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
  const resourceBundle = createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy, runId }) => ({
      id: "resource_bundle_basic",
      runId,
      createdAt: "2025-01-01T00:00:00.000Z",
      producedBy,
    }),
    runId: bundle.spec.meta.runId,
    producedBy: "fixture",
    emitVisualAssets: true,
  });
  bundle.artifacts.push(resourceBundle);
  manifest.artifacts.push({
    id: resourceBundle.meta.id,
    schema: resourceBundle.schema,
    schemaVersion: resourceBundle.schemaVersion,
    path: "resource-bundle.json",
  });
  manifest.schemas.push({
    schema: resourceBundle.schema,
    schemaVersion: resourceBundle.schemaVersion,
    description: "Visual resource bundle with generated imagery data.",
  });
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
    assert.match(manifestOutput.textContent, /resource-bundle\.json/);
    assert.match(specTextarea.value, /agent-kernel\/BuildSpec/);

    const intent = JSON.parse(intentOutput.textContent);
    assert.equal(intent.goal, bundle.spec.intent.goal);
    assert.equal(artifactsContainer.children.length, bundle.artifacts.length);
    assert.equal(bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/ResourceBundleArtifact"), true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});

test("build result readiness follows the persisted canonical bundle shape", () => {
  assert.equal(
    buildResultHasBundle({
      ok: true,
      response: {
        bundle: { spec: {}, artifacts: [] },
      },
    }),
    true,
  );
  assert.equal(
    buildResultHasBundle({
      ok: true,
      snapshot: {
        response: {
          bundle: { spec: {}, artifacts: [] },
        },
      },
    }),
    true,
  );
  assert.equal(
    buildResultHasBundle({
      ok: true,
      preview: { ready: true },
      response: { manifest: {} },
    }),
    false,
  );
});

test("bundle review normalizes agent-authored build specs on load", async () => {
  const originalDocument = globalThis.document;

  globalThis.document = {
    createElement: (tag) => makeElement(tag),
  };

  try {
    const specTextarea = makeInput("");
    const bundleReview = wireBundleReview({
      elements: {
        bundleInput: makeInput(""),
        manifestInput: makeInput(""),
        loadLastButton: makeButton(),
        clearButton: makeButton(),
        statusEl: { textContent: "" },
        schemaList: makeElement("ul"),
        manifestOutput: { textContent: "" },
        specTextarea,
        specErrors: makeElement("ul"),
        applySpecButton: makeButton(),
        sendSpecButton: makeButton(),
        downloadSpecButton: makeButton(),
        intentOutput: { textContent: "" },
        planOutput: { textContent: "" },
        configuratorOutput: { textContent: "" },
        artifactsContainer: makeElement("div"),
      },
    });

    const loaded = bundleReview.loadBundlePayload({
      spec: {
        schema: "agent-kernel/BuildSpec",
        schemaVersion: 1,
        meta: {
          id: "build_spec_bundle_review",
          runId: "run_bundle_review",
          createdAt: "2026-04-08T00:00:00.000Z",
          source: "ui-test",
        },
        intent: {
          goal: "Normalize loaded authoring spec",
        },
        authoring: {
          objectKinds: "room",
          request: {
            schema: "agent-kernel/AgentCommandRequestArtifact",
            schemaVersion: 1,
            meta: {
              id: "agent_command_bundle_review",
              runId: "run_bundle_review",
              createdAt: "2026-04-08T00:00:00.000Z",
              producedBy: "test",
            },
            command: {
              action: "author",
              text: "author one room",
              source: "ui-test",
              taxonomyVersion: 1,
            },
            objects: {
              kind: "room",
              prompt: "one room",
              count: 1,
            },
            compilation: {
              rules: {
                kind: "room",
                compileTo: {
                  target: "build_spec_plan",
                  path: "plan.hints.cardSet",
                },
              },
            },
          },
        },
      },
      artifacts: [],
    }, { source: "file" });

    assert.equal(loaded, true);
    const normalizedSpec = JSON.parse(specTextarea.value);
    assert.deepEqual(normalizedSpec.authoring.objectKinds, ["room"]);
    assert.equal(Array.isArray(normalizedSpec.authoring.request.objects), true);
    assert.equal(Array.isArray(normalizedSpec.authoring.request.compilation.rules), true);
    assert.equal(Array.isArray(normalizedSpec.authoring.request.compilation.rules[0].compileTo), true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("load-last snapshot source is eligible for design hydration", async () => {
  assert.equal(shouldHydrateDesignFromBundleSource("snapshot"), true);
  assert.equal(shouldHydrateDesignFromBundleSource("file"), true);
  assert.equal(shouldHydrateDesignFromBundleSource("ipfs"), true);
  assert.equal(shouldHydrateDesignFromBundleSource("build"), false);
  assert.equal(shouldHydrateDesignFromBundleSource("clear"), false);
});
