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

test("persona tabs render in the expected order", () => {
  const html = readHtml();
  const tabIds = [...html.matchAll(/data-tab="([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabIds, [
    "runtime",
    "configurator",
    "actor",
    "director",
    "allocator",
    "annotator",
    "moderator",
    "orchestrator",
    "llm",
  ]);
  assert.match(html, /data-tab="runtime"[^>]*aria-selected="true"/);
});

test("runtime panel contains playback controls", () => {
  const html = readHtml();
  const runtimeStart = html.indexOf('data-tab-panel="runtime"');
  assert.ok(runtimeStart >= 0);
  const runtimeTail = html.slice(runtimeStart);
  const nextPanelIndex = runtimeTail.indexOf('data-tab-panel="', 'data-tab-panel="runtime"'.length);
  const runtimePanel = nextPanelIndex === -1 ? runtimeTail : runtimeTail.slice(0, nextPanelIndex);
  assert.match(runtimePanel, /id="frame-buffer"/);
  assert.match(runtimePanel, /id="actor-id-display"/);
  assert.match(runtimePanel, /id="play-pause"/);
  assert.doesNotMatch(runtimePanel, /id="seed-input"/);
  assert.doesNotMatch(runtimePanel, /id="adapter-output"/);
});

test("runtime panel is visible by default", () => {
  const html = readHtml();
  const runtimeOpen = html.match(/<div class="tab-panel" data-tab-panel="runtime"[^>]*>/);
  assert.ok(runtimeOpen);
  assert.equal(runtimeOpen[0].includes("hidden"), false);
});

test("persona empty-state copy is present", () => {
  const html = readHtml();
  assert.match(html, /No director panels yet\./);
  assert.match(html, /Budgeting artifacts are surfaced here\./);
  assert.match(html, /No JSON output yet\./);
});

test("actor tab contains actor lists", () => {
  const html = readHtml();
  const actorStart = html.indexOf('data-tab-panel="actor"');
  assert.ok(actorStart >= 0);
  const actorTail = html.slice(actorStart);
  const nextPanelIndex = actorTail.indexOf('data-tab-panel="', 'data-tab-panel="actor"'.length);
  const actorPanel = nextPanelIndex === -1 ? actorTail : actorTail.slice(0, nextPanelIndex);
  assert.match(actorPanel, /id="actor-list"/);
  assert.match(actorPanel, /id="tile-actor-list"/);
  assert.match(actorPanel, /id="actor-json-output"/);
});

test("allocator tab placeholder is present", () => {
  const html = readHtml();
  const allocatorStart = html.indexOf('data-tab-panel="allocator"');
  assert.ok(allocatorStart >= 0);
  const allocatorTail = html.slice(allocatorStart);
  const nextPanelIndex = allocatorTail.indexOf('data-tab-panel="', 'data-tab-panel="allocator"'.length);
  const allocatorPanel = nextPanelIndex === -1 ? allocatorTail : allocatorTail.slice(0, nextPanelIndex);
  assert.match(allocatorPanel, /Budgeting artifacts are surfaced here\./);
  assert.match(allocatorPanel, /id="allocator-budget-json"/);
  assert.match(allocatorPanel, /id="allocator-price-list-json"/);
  assert.match(allocatorPanel, /id="allocator-receipt-json"/);
});

test("director tab placeholder is present", () => {
  const html = readHtml();
  const directorStart = html.indexOf('data-tab-panel="director"');
  assert.ok(directorStart >= 0);
  const directorTail = html.slice(directorStart);
  const nextPanelIndex = directorTail.indexOf('data-tab-panel="', 'data-tab-panel="director"'.length);
  const directorPanel = nextPanelIndex === -1 ? directorTail : directorTail.slice(0, nextPanelIndex);
  assert.match(directorPanel, /No director panels yet\./);
  assert.match(directorPanel, /id="director-json-output"/);
});

test("annotator tab contains affinity and trap panels", () => {
  const html = readHtml();
  const annotatorStart = html.indexOf('data-tab-panel="annotator"');
  assert.ok(annotatorStart >= 0);
  const annotatorTail = html.slice(annotatorStart);
  const nextPanelIndex = annotatorTail.indexOf('data-tab-panel="', 'data-tab-panel="annotator"'.length);
  const annotatorPanel = nextPanelIndex === -1 ? annotatorTail : annotatorTail.slice(0, nextPanelIndex);
  assert.match(annotatorPanel, /id="affinity-list"/);
  assert.match(annotatorPanel, /id="trap-list"/);
  assert.match(annotatorPanel, /id="annotator-json-output"/);
});

test("moderator tab contains output placeholder", () => {
  const html = readHtml();
  const moderatorStart = html.indexOf('data-tab-panel="moderator"');
  assert.ok(moderatorStart >= 0);
  const moderatorTail = html.slice(moderatorStart);
  const nextPanelIndex = moderatorTail.indexOf('data-tab-panel="', 'data-tab-panel="moderator"'.length);
  const moderatorPanel = nextPanelIndex === -1 ? moderatorTail : moderatorTail.slice(0, nextPanelIndex);
  assert.match(moderatorPanel, /Playback controls live in the Runtime tab\./);
  assert.match(moderatorPanel, /id="moderator-json-output"/);
});

test("orchestrator tab contains adapter output", () => {
  const html = readHtml();
  const orchestratorStart = html.indexOf('data-tab-panel="orchestrator"');
  assert.ok(orchestratorStart >= 0);
  const orchestratorTail = html.slice(orchestratorStart);
  const nextPanelIndex = orchestratorTail.indexOf('data-tab-panel="', 'data-tab-panel="orchestrator"'.length);
  const orchestratorPanel = nextPanelIndex === -1 ? orchestratorTail : orchestratorTail.slice(0, nextPanelIndex);
  assert.match(orchestratorPanel, /id="adapter-output"/);
  assert.match(orchestratorPanel, /No JSON output yet\./);
});

test("configurator tab contains run builder inputs", () => {
  const html = readHtml();
  const configuratorStart = html.indexOf('data-tab-panel="configurator"');
  assert.ok(configuratorStart >= 0);
  const configuratorTail = html.slice(configuratorStart);
  const nextPanelIndex = configuratorTail.indexOf('data-tab-panel="', 'data-tab-panel="configurator"'.length);
  const configuratorPanel = nextPanelIndex === -1 ? configuratorTail : configuratorTail.slice(0, nextPanelIndex);
  assert.match(configuratorPanel, /id="seed-input"/);
  assert.match(configuratorPanel, /id="start-run"/);
  assert.match(configuratorPanel, /id="config-preview"/);
  assert.match(configuratorPanel, /id="base-tiles"/);
  assert.match(configuratorPanel, /id="config-budget-json"/);
  assert.match(configuratorPanel, /id="config-price-list-json"/);
  assert.match(configuratorPanel, /id="config-receipt-json"/);
});
