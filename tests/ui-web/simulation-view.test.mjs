import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveCanvasBoardPosition } from "../../packages/ui-web/src/views/simulation-view.js";

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

test("simulation view keeps the playing surface, playback controls, and board action controls", () => {
  const html = readHtml();
  const simulationPanel = slicePanel(html, "simulation");
  assert.match(simulationPanel, /id="frame-buffer"/);
  assert.match(simulationPanel, /id="play-pause"/);
  assert.match(simulationPanel, /id="step-back"/);
  assert.match(simulationPanel, /id="step-forward"/);
  assert.match(simulationPanel, /id="reset-run"/);
  assert.match(simulationPanel, /id="runtime-move-up"/);
  assert.match(simulationPanel, /id="runtime-move-down"/);
  assert.match(simulationPanel, /id="runtime-move-left"/);
  assert.match(simulationPanel, /id="runtime-move-right"/);
  assert.match(simulationPanel, /id="runtime-cast"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-inspector-toggle"/);
  assert.doesNotMatch(simulationPanel, /id="actor-id-display"/);
  assert.doesNotMatch(simulationPanel, /id="actor-pos"/);
  assert.doesNotMatch(simulationPanel, /id="actor-hp"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-visibility-mode"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-viewer-actor"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-viewport-size"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-vision-radius"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-exploration-hud"/);
  assert.doesNotMatch(simulationPanel, /id="event-stream"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-viewport"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-delver-card"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-visible-wardens"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-offscreen-wardens"/);
  assert.doesNotMatch(simulationPanel, /Selected Actor View/);
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

test("simulation canvas hit-testing translates viewport-local tile positions back to board coordinates", () => {
  assert.deepEqual(
    resolveCanvasBoardPosition(
      { x: 2, y: 3 },
      { viewport: { startX: 10, startY: 20, width: 5, height: 5, endX: 15, endY: 25 } },
    ),
    { x: 12, y: 23 },
  );
  assert.deepEqual(resolveCanvasBoardPosition({ x: 1, y: 1 }, null), { x: 1, y: 1 });
  assert.equal(resolveCanvasBoardPosition(null, { viewport: { startX: 4, startY: 7 } }), null);
});
