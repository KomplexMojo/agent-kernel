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
  assert.match(html, /data-tab="simulation"[^>]*>Game Board</);
  assert.doesNotMatch(html, /data-tab="simulation"[^>]*>Simulation</);
  assert.match(html, /data-tab="design"[^>]*aria-selected="true"/);
});

test("design panel contains the unified card workspace layout", () => {
  const html = readHtml();
  const designPanel = getFirstPanelSlice(html, "design");

  const typeIdx = designPanel.indexOf('id="design-property-group-type"');
  const affinityIdx = designPanel.indexOf('id="design-property-group-affinities"');
  const expressionIdx = designPanel.indexOf('id="design-property-group-expressions"');
  const motivationIdx = designPanel.indexOf('id="design-property-group-motivations"');

  assert.ok(typeIdx >= 0);
  assert.ok(affinityIdx > typeIdx);
  assert.ok(expressionIdx > affinityIdx);
  assert.ok(motivationIdx > expressionIdx);

  assert.match(designPanel, /id="design-card-grid"/);
  assert.match(designPanel, /id="design-level-budget"/);
  assert.match(designPanel, /id="design-budget-split-room"/);
  assert.match(designPanel, /id="design-budget-split-attacker"/);
  assert.match(designPanel, /id="design-budget-split-defender"/);
  assert.match(designPanel, /id="design-budget-split-room-tokens"/);
  assert.match(designPanel, /id="design-budget-split-attacker-tokens"/);
  assert.match(designPanel, /id="design-budget-split-defender-tokens"/);
  assert.match(designPanel, /id="design-budget-overview"/);
  assert.match(designPanel, /id="design-card-group-room"/);
  assert.match(designPanel, /id="design-card-group-attacker"/);
  assert.match(designPanel, /id="design-card-group-defender"/);
  assert.match(designPanel, /id="design-card-group-budget-room"/);
  assert.match(designPanel, /id="design-card-group-budget-attacker"/);
  assert.match(designPanel, /id="design-card-group-budget-defender"/);
  assert.doesNotMatch(designPanel, /id="design-ai-prompt"/);
  assert.doesNotMatch(designPanel, /id="design-ai-generate"/);
  assert.doesNotMatch(designPanel, /id="design-brief-output"/);
  assert.doesNotMatch(designPanel, /id="design-spend-ledger-output"/);
  assert.doesNotMatch(designPanel, /id="design-card-set-json"/);
  assert.match(designPanel, /id="design-build-and-load"/);
  assert.match(designPanel, /id="design-build-status"/);
});

test("simulation panel contains playback controls", () => {
  const html = readHtml();
  const simulationPanel = getFirstPanelSlice(html, "simulation");
  assert.match(simulationPanel, /id="frame-buffer"/);
  assert.match(simulationPanel, /id="play-pause"/);
  assert.match(simulationPanel, /id="step-back"/);
  assert.match(simulationPanel, /id="step-forward"/);
  assert.match(simulationPanel, /id="runtime-move-up"/);
  assert.match(simulationPanel, /id="runtime-move-down"/);
  assert.match(simulationPanel, /id="runtime-move-left"/);
  assert.match(simulationPanel, /id="runtime-move-right"/);
  assert.match(simulationPanel, /id="runtime-cast"/);
  assert.match(simulationPanel, /id="runtime-status"/);
  assert.doesNotMatch(simulationPanel, /id="actor-id-display"/);
  assert.doesNotMatch(simulationPanel, /id="simulation-visibility-mode"/);
  assert.doesNotMatch(simulationPanel, /id="runtime-viewport"/);
});
