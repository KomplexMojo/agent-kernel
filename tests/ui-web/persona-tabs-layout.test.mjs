import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.resolve(root, "packages", "ui-web", "index.html");

function readHtml() {
  return fs.readFileSync(htmlPath, "utf8");
}

function getPanelOpenings(html, tabId) {
  const pattern = new RegExp(`<div class="tab-panel" data-tab-panel="${tabId}"[^>]*>`, "g");
  return [...html.matchAll(pattern)].map((match) => match[0]);
}

function getFirstPanelSlice(html, tabId) {
  const marker = `data-tab-panel="${tabId}"`;
  const startIndex = html.indexOf(marker);
  assert.ok(startIndex >= 0);
  const panelStart = html.lastIndexOf("<div", startIndex);
  const nextPanelIndex = html.indexOf('data-tab-panel="', startIndex + marker.length);
  return nextPanelIndex === -1 ? html.slice(panelStart) : html.slice(panelStart, nextPanelIndex);
}

test("primary workflow tabs render in the expected order", () => {
  const html = readHtml();
  const tabIds = [...html.matchAll(/data-tab="([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabIds, ["design", "simulation", "diagnostics"]);
  assert.match(html, /data-tab="design"[^>]*aria-selected="true"/);
});

test("design panels are visible by default", () => {
  const html = readHtml();
  const designPanels = getPanelOpenings(html, "design");
  assert.ok(designPanels.length > 0);
  designPanels.forEach((panel) => {
    assert.equal(panel.includes("hidden"), false);
  });
});

test("simulation and diagnostics panels are hidden by default", () => {
  const html = readHtml();
  const simulationPanels = getPanelOpenings(html, "simulation");
  const diagnosticsPanels = getPanelOpenings(html, "diagnostics");
  assert.ok(simulationPanels.length > 0);
  assert.ok(diagnosticsPanels.length > 0);
  simulationPanels.forEach((panel) => {
    assert.ok(panel.includes("hidden"));
  });
  diagnosticsPanels.forEach((panel) => {
    assert.ok(panel.includes("hidden"));
  });
});

test("simulation panel contains playback controls", () => {
  const html = readHtml();
  const simulationPanel = getFirstPanelSlice(html, "simulation");
  assert.match(simulationPanel, /id="frame-buffer"/);
  assert.match(simulationPanel, /id="actor-id-display"/);
  assert.match(simulationPanel, /id="play-pause"/);
  assert.doesNotMatch(simulationPanel, /id="seed-input"/);
  assert.doesNotMatch(simulationPanel, /id="adapter-output"/);
});
