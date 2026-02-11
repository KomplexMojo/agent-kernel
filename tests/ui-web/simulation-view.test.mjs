import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.resolve(root, "packages", "ui-web", "index.html");

function readHtml() {
  return fs.readFileSync(htmlPath, "utf8");
}

function slicePanel(html, tabId) {
  const marker = `data-tab-panel="${tabId}"`;
  const startIndex = html.indexOf(marker);
  assert.ok(startIndex >= 0);
  const panelStart = html.lastIndexOf("<div", startIndex);
  const nextPanelIndex = html.indexOf('data-tab-panel="', startIndex + marker.length);
  return nextPanelIndex === -1 ? html.slice(panelStart) : html.slice(panelStart, nextPanelIndex);
}

test("simulation view includes run controls and event stream", () => {
  const html = readHtml();
  const simulationPanel = slicePanel(html, "simulation");
  assert.match(simulationPanel, /id="frame-buffer"/);
  assert.match(simulationPanel, /id="play-pause"/);
  assert.match(simulationPanel, /id="event-stream"/);
});

test("simulation view loads wasm from ui-web assets", () => {
  const viewPath = path.resolve(root, "packages", "ui-web", "src", "views", "simulation-view.js");
  const source = fs.readFileSync(viewPath, "utf8");
  const match = source.match(/new URL\((['"`])([^'"`]+core-as\.wasm)\1,\s*import\.meta\.url\)/);
  assert.ok(match, "expected simulation view to resolve core-as.wasm via new URL");
  const wasmRelative = match[2];
  const wasmUrl = new URL(wasmRelative, pathToFileURL(viewPath));
  const wasmPath = fileURLToPath(wasmUrl);
  assert.ok(fs.existsSync(wasmPath), `expected wasm file at ${wasmPath}`);
  assert.match(wasmPath, /packages\/ui-web\/assets\/core-as\.wasm$/);
});
