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

test("artifact panels live only under diagnostics", () => {
  const html = readHtml();
  const designText = getPanelSlices(html, "design").join("\n");
  const simulationText = getPanelSlices(html, "simulation").join("\n");
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
    "allocator-budget-json",
    "allocator-price-list-json",
    "allocator-receipt-json",
    "adapter-output",
  ];
  const diagnosticsOnlyIds = [
    "llm-trace-status",
    "llm-trace-count",
    "llm-trace-turns",
    "llm-trace-prompt",
    "llm-trace-response-raw",
    "llm-trace-response-parsed",
    "llm-trace-errors",
    "llm-trace-summary",
    "llm-trace-telemetry",
  ];

  artifactIds.forEach((id) => {
    assert.ok(diagnosticsText.includes(`id=\"${id}\"`), `Expected diagnostics to include ${id}`);
    assert.equal(designText.includes(`id=\"${id}\"`), false, `Did not expect design to include ${id}`);
    assert.equal(simulationText.includes(`id=\"${id}\"`), false, `Did not expect simulation to include ${id}`);
  });
  diagnosticsOnlyIds.forEach((id) => {
    assert.ok(diagnosticsText.includes(`id=\"${id}\"`), `Expected diagnostics to include ${id}`);
    assert.equal(designText.includes(`id=\"${id}\"`), false, `Did not expect design to include ${id}`);
    assert.equal(simulationText.includes(`id=\"${id}\"`), false, `Did not expect simulation to include ${id}`);
  });

  assert.equal(diagnosticsText.includes("id=\"adapter-mode\""), false, "Did not expect fixture/live mode toggle");
  assert.equal(diagnosticsText.includes("Ready in fixture mode"), false, "Did not expect fixture status text");
  assert.ok(diagnosticsText.includes("Ready in live mode"), "Expected live mode status text");
});
