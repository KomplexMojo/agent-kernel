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

test("layout hierarchy keeps the simulation workspace and preview workspace active", () => {
  const html = readHtml();
  assert.match(html, /\.workspace\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(html, /\.workspace\[data-active-tab="preview"\],\s*\.workspace\[data-active-tab="simulation"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(260px,\s*340px\)/);
  assert.match(html, /\.workspace\[data-active-tab="simulation"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(260px,\s*340px\)/);
  assert.match(html, /\.workspace:not\(\[data-active-tab="simulation"\]\):not\(\[data-active-tab="preview"\]\)\s*#actor-inspector\s*\{[^}]*display:\s*none/);
  assert.match(html, /\.inspector-shell\s*\{[^}]*position:\s*sticky/);
  assert.match(html, /#frame-buffer\s*\{[^}]*min-height:\s*520px/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?main\s*\{[^}]*max-width:\s*1760px/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?\.workspace\[data-active-tab="preview"\],\s*\.workspace\[data-active-tab="simulation"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*420px\)/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?\.workspace\[data-active-tab="simulation"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*420px\)/);
  assert.match(html, /\.design-card-workspace\s*\{[^}]*grid-template-columns:\s*280px\s*minmax\(0,\s*1\.05fr\)\s*280px/);
  assert.match(html, /\.design-center-workspace\s*\{[^}]*align-content:\s*start[^}]*grid-auto-rows:\s*max-content/);
  assert.match(html, /\.design-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(380px,\s*1fr\)[^}]*justify-content:\s*stretch/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?\.design-card-workspace\s*\{[^}]*grid-template-columns:\s*320px\s*minmax\(0,\s*1\.2fr\)\s*320px/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?\.design-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(460px,\s*1fr\)/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?#frame-buffer\s*\{[^}]*min-height:\s*620px/);
  assert.match(html, /#preview-frame-buffer\s*\{[^}]*min-height:\s*420px/);
  assert.match(html, /#preview-render-canvas\s*\{[^}]*min-height:\s*420px/);
  assert.match(html, /id="actor-inspector"[^>]*hidden/);
  assert.doesNotMatch(html, /\.runtime-shell\s*\{/);
  assert.doesNotMatch(html, /\.runtime-viewport\s*\{/);
  assert.doesNotMatch(html, /id="runtime-viewport"/);
});
