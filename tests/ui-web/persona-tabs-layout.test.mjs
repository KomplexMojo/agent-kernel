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
  assert.deepEqual(tabIds, ["design", "gameplay"]);
  assert.match(html, /data-tab="gameplay"[^>]*>Gameplay</);
  assert.match(html, /data-tab="design"[^>]*aria-selected="true"/);
  assert.doesNotMatch(html, /data-tab="preview"[^>]*>Preview</);
  assert.doesNotMatch(html, /data-tab="simulation"[^>]*>Run</);
  assert.doesNotMatch(html, /data-tab="diagnostics"[^>]*>Diagnostics</);
});

test("gameplay panel contains Phaser host and tick navigation controls", () => {
  const html = readHtml();
  const gameplayPanel = getFirstPanelSlice(html, "gameplay");
  assert.match(gameplayPanel, /id="gameplay-phaser-host"/);
  assert.match(gameplayPanel, /id="gameplay-status"/);
  assert.match(gameplayPanel, /id="gameplay-step-back"/);
  assert.match(gameplayPanel, /id="gameplay-step-forward"/);
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
    /id="design-guidance-status"[^>]*>Configure a card, then shelve it\.<\/div>/,
  );
});

test("preview panel contains the active preview surface", () => {
  const html = readHtml();
  const previewPanel = getFirstPanelSlice(html, "preview");

  [
    "preview-build-and-load",
    "preview-status",
    "preview-summary",
    "preview-actor-list",
  ].forEach((id) => {
    assert.match(previewPanel, new RegExp(`id="${id}"`));
  });

  assert.match(previewPanel, /Build And Load Game/);
  assert.doesNotMatch(previewPanel, /id="preview-render-canvas"/);
  assert.doesNotMatch(previewPanel, /id="preview-frame-buffer"/);
  assert.doesNotMatch(previewPanel, /id="preview-renderer-host"/);
  assert.doesNotMatch(previewPanel, /id="preview-renderer-canvas"/);
  assert.doesNotMatch(previewPanel, /id="preview-renderer-phaser"/);
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

test("diagnostics panel contains the build pipeline section", () => {
  const html = readHtml();
  const diagnosticsPanel = getFirstPanelSlice(html, "diagnostics");

  [
    "build-run",
    "build-spec-json",
    "build-output",
    "build-status",
    "bundle-file",
    "bundle-status",
    "bundle-artifacts",
  ].forEach((id) => {
    assert.match(diagnosticsPanel, new RegExp(`id="${id}"`));
  });

  [
    "diagnostic-toggle-allocator",
    "diagnostic-toggle-llm-trace",
    "diagnostic-toggle-adapter-playground",
    "llm-trace-status",
    "adapter-output",
    "allocator-budget-json",
    "bundle-run-runtime",
  ].forEach((id) => {
    assert.doesNotMatch(diagnosticsPanel, new RegExp(`id="${id}"`));
  });
});
