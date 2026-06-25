import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wireDiagnosticsView } from "../../packages/ui-web/src/views/diagnostics-view.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.resolve(root, "packages", "ui-web", "index_c.html");
const bundleFixturePath = path.resolve(root, "tests", "fixtures", "ui", "build-spec-bundle", "bundle.json");

function readHtml() {
  return fs.readFileSync(htmlPath, "utf8");
}

function getPanelSlices(html, tabId) {
  const pattern = new RegExp(`<div class=\"tab-panel\" data-tab-panel=\"${tabId}\"[^>]*>`, "g");
  const matches = [...html.matchAll(pattern)];
  return matches.map((match) => {
    const startIndex = match.index ?? 0;
    const nextPanelIndex = html.indexOf('data-tab-panel="', startIndex + match[0].length);
    if (nextPanelIndex === -1) {
      return html.slice(startIndex);
    }
    return html.slice(startIndex, nextPanelIndex);
  });
}

function makeNode(tagName = "div") {
  const handlers = {};
  return {
    tagName: String(tagName).toUpperCase(),
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    files: [],
    dataset: {},
    style: {},
    children: [],
    className: "",
    addEventListener(event, handler) {
      handlers[event] = handler;
    },
    dispatchEvent(event) {
      const handler = handlers[event?.type];
      if (handler) handler(event);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    click() {},
  };
}

function makeRoot() {
  const elements = new Map();
  return {
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      if (!elements.has(selector)) {
        elements.set(selector, makeNode());
      }
      return elements.get(selector);
    },
  };
}

function makeStorage(initialEntries = {}) {
  const entries = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

test("artifact panels live only under diagnostics", () => {
  const html = readHtml();
  const designText = getPanelSlices(html, "design").join("\n");
  const diagnosticsText = getPanelSlices(html, "diagnostics").join("\n");

  const artifactIds = [
    "bundle-artifacts",
    "bundle-schemas",
    "bundle-manifest",
    "bundle-spec-edit",
    "build-output",
    "build-spec-json",
    "build-validation",
    "config-budget-json",
    "config-price-list-json",
    "config-receipt-json",
  ];
  const diagnosticsOnlyIds = [];
  const removedIds = [
    "bundle-run-runtime",
    "diagnostic-toggle-actors",
    "diagnostic-toggle-director",
    "diagnostic-toggle-affinity",
    "diagnostic-toggle-moderator",
    "actor-json-output",
    "director-json-output",
    "annotator-json-output",
    "moderator-json-output",
    "allocator-budget-json",
    "allocator-price-list-json",
    "allocator-receipt-json",
    "adapter-output",
    "llm-trace-status",
    "llm-trace-count",
  ];

  artifactIds.forEach((id) => {
    assert.ok(diagnosticsText.includes(`id=\"${id}\"`), `Expected diagnostics to include ${id}`);
    assert.equal(designText.includes(`id=\"${id}\"`), false, `Did not expect design to include ${id}`);
  });
  diagnosticsOnlyIds.forEach((id) => {
    assert.ok(diagnosticsText.includes(`id=\"${id}\"`), `Expected diagnostics to include ${id}`);
    assert.equal(designText.includes(`id=\"${id}\"`), false, `Did not expect design to include ${id}`);
  });
  removedIds.forEach((id) => {
    assert.equal(diagnosticsText.includes(`id=\"${id}\"`), false, `Did not expect diagnostics to include ${id}`);
  });

  assert.equal(diagnosticsText.includes('id="adapter-mode"'), false, "Did not expect fixture/live mode toggle");
  assert.equal(diagnosticsText.includes("Ready in fixture mode"), false, "Did not expect fixture status text");
});

test("diagnostics view can replay a saved build snapshot during initialization", () => {
  const originalDocument = globalThis.document;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocalStorage = globalThis.localStorage;
  const bundle = JSON.parse(fs.readFileSync(bundleFixturePath, "utf8"));
  const snapshot = {
    runId: "saved-ui-build",
    response: { bundle },
  };

  globalThis.document = {
    createElement: makeNode,
  };
  globalThis.sessionStorage = makeStorage({
    "ak.build.last.session": JSON.stringify(snapshot),
  });
  globalThis.localStorage = makeStorage();

  try {
    const rootEl = makeRoot();
    assert.doesNotThrow(() => wireDiagnosticsView({
      root: rootEl,
      commandHost: {
        async build() {
          return { ok: true };
        },
      },
    }));
    assert.match(rootEl.querySelector("#build-status").textContent, /Auto-loaded runId saved-ui-build from session/);
    assert.notEqual(rootEl.querySelector("#config-budget-json").textContent, "");
  } finally {
    globalThis.document = originalDocument;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.localStorage = originalLocalStorage;
  }
});
