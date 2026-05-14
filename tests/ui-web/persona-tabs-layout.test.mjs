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
  assert.deepEqual(tabIds, ["design", "preview", "simulation", "diagnostics"]);
  assert.match(html, /data-tab="preview"[^>]*>Preview</);
  assert.match(html, /data-tab="simulation"[^>]*>Run</);
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
  assert.match(designPanel, /id="design-guidance-status"/);
  assert.match(designPanel, /id="design-auto-generate"/);
  assert.match(designPanel, /id="design-level-budget"/);
  assert.match(designPanel, /id="design-budget-split-room"/);
  assert.match(designPanel, /id="design-budget-split-delver"/);
  assert.match(designPanel, /id="design-budget-split-warden"/);
  assert.match(designPanel, /id="design-card-group-room"/);
  assert.match(designPanel, /id="design-card-group-delver"/);
  assert.match(designPanel, /id="design-card-group-warden"/);
  assert.match(designPanel, /id="design-card-group-resource"/);
  const budgetOverviewIdx = designPanel.indexOf('id="design-budget-overview"');
  const statusIdx = designPanel.indexOf('id="design-guidance-status"');
  const cardGridIdx = designPanel.indexOf('id="design-card-grid"');
  assert.ok(budgetOverviewIdx >= 0);
  assert.ok(statusIdx > budgetOverviewIdx);
  assert.ok(cardGridIdx > statusIdx);
  assert.doesNotMatch(designPanel, /id="design-build-and-load"/);
  assert.doesNotMatch(designPanel, /Build And Load Game/);
  assert.doesNotMatch(designPanel, /<small class="status">/);
  assert.doesNotMatch(designPanel, /Drag chips onto this card\./);
  assert.match(
    designPanel,
    /id="design-guidance-status"[^>]*>Configure one card in the center, then pull it right into grouped Room\/Delver\/Warden\/Hazard shelves\.<\/div>/,
  );
});

test("game board panel contains a Phaser surface and shell playback controls only", () => {
  const html = readHtml();
  const simulationPanel = getFirstPanelSlice(html, "simulation");

  [
    "status-message",
    "simulation-phaser-host",
    "frame-buffer",
    "play-pause",
    "step-back",
    "step-forward",
    "reset-run",
  ].forEach((id) => {
    assert.match(simulationPanel, new RegExp(`id="${id}"`));
  });

  assert.match(simulationPanel, /Playing Surface/);
  assert.doesNotMatch(simulationPanel, /Runtime Actions/);
  assert.doesNotMatch(simulationPanel, /Affinity Placeholders/);
  assert.doesNotMatch(simulationPanel, /class="runtime-controls"/);
  assert.doesNotMatch(simulationPanel, /class="runtime-affinity-placeholders"/);
  assert.ok(simulationPanel.indexOf('id="status-message"') < simulationPanel.indexOf('id="simulation-phaser-host"'));
  assert.ok(simulationPanel.indexOf('id="simulation-phaser-host"') < simulationPanel.indexOf('id="frame-buffer"'));
  assert.doesNotMatch(simulationPanel, /<small class="status">/);
  assert.match(
    simulationPanel,
    /id="status-message"[^>]*>Build and load a game from Preview, then select a room, delver, or warden to inspect and control it here\.<\/div>/,
  );
  assert.doesNotMatch(simulationPanel, /Selected Actor View/);
  [
    "runtime-viewport",
    "runtime-status",
    "runtime-delver-card",
    "runtime-visible-wardens",
    "runtime-offscreen-wardens",
    "runtime-move-up-left",
    "runtime-move-up",
    "runtime-move-up-right",
    "runtime-move-down",
    "runtime-move-down-right",
    "runtime-move-down-left",
    "runtime-move-left",
    "runtime-move-right",
    "runtime-cast",
    "runtime-affinity-choice-fire",
    "runtime-affinity-choice-water",
    "runtime-affinity-choice-earth",
    "runtime-affinity-expression-expand",
    "runtime-affinity-expression-focus",
    "runtime-affinity-expression-shift",
  ].forEach((id) => {
    assert.doesNotMatch(simulationPanel, new RegExp(`id="${id}"`));
  });
});

test("preview panel contains the active preview surface", () => {
  const html = readHtml();
  const previewPanel = getFirstPanelSlice(html, "preview");

  [
    "preview-build-and-load",
    "preview-status",
    "preview-render-canvas",
    "preview-frame-buffer",
    "preview-summary",
    "preview-actor-list",
  ].forEach((id) => {
    assert.match(previewPanel, new RegExp(`id="${id}"`));
  });

  assert.match(previewPanel, /Game Preview/);
  assert.match(previewPanel, /Build And Load Game/);
  assert.ok(previewPanel.indexOf('id="preview-status"') < previewPanel.indexOf('id="preview-frame-buffer"'));
  assert.doesNotMatch(previewPanel, /<small class="status">/);
  assert.match(
    previewPanel,
    /id="preview-status"[^>]*>Inspect the current design bundle here\. When ready, use Build And Load Game to open Run\.<\/div>/,
  );
});

test("game board layout includes the right-rail actor inspector", () => {
  const html = readHtml();

  [
    "actor-inspector",
    "actor-inspector-room-list",
    "actor-inspector-delver-list",
    "actor-inspector-warden-list",
    "actor-inspector-detail",
  ].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });

  assert.match(
    html,
    /\.simulation-inspector-group-list\s*\{[\s\S]*max-height:\s*calc\(4 \* 34px \+ 3 \* 6px\);[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/,
  );
});

test("diagnostics panel keeps only the active section toggles", () => {
  const html = readHtml();
  const diagnosticsPanel = getFirstPanelSlice(html, "diagnostics");

  [
    "diagnostic-toggle-allocator",
    "diagnostic-toggle-llm-trace",
    "diagnostic-toggle-build",
    "diagnostic-toggle-adapter-playground",
  ].forEach((id) => {
    assert.match(diagnosticsPanel, new RegExp(`id="${id}"`));
  });

  [
    "diagnostic-toggle-actors",
    "diagnostic-toggle-director",
    "diagnostic-toggle-affinity",
    "diagnostic-toggle-moderator",
    "bundle-run-runtime",
  ].forEach((id) => {
    assert.doesNotMatch(diagnosticsPanel, new RegExp(`id="${id}"`));
  });
});
