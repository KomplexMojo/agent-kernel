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

test("layout hierarchy styles include workspace grid and inspector drawer", () => {
  const html = readHtml();
  assert.match(html, /\.workspace\s*\{[^}]*grid-template-columns:/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?main\s*\{[^}]*max-width:\s*1760px/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?\.workspace\[data-active-tab="simulation"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*420px\)/);
  assert.match(html, /@media\s*\(min-width:\s*1680px\)\s*and\s*\(min-height:\s*900px\)[\s\S]*?\.design-card-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(220px,\s*280px\)\s*minmax\(0,\s*1fr\)\s*minmax\(280px,\s*360px\)/);
  assert.match(html, /\.workspace\[data-active-tab="simulation"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(260px,\s*340px\)/);
  assert.match(html, /\.workspace\[data-active-tab="simulation"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(220px,\s*300px\)/);
  assert.match(html, /\.workspace\[data-active-tab="simulation"\]\s*\.inspector-shell\s*\{[^}]*position:\s*sticky/);
  assert.match(html, /\.inspector-shell\s*\{[^}]*position:\s*sticky/);
  assert.match(html, /#frame-buffer\s*\{[^}]*overflow:\s*auto/);
  assert.match(html, /id="actor-inspector"[^>]*hidden/);
  assert.doesNotMatch(html, /id="actor-inspector-close"/);
  assert.doesNotMatch(html, /id="simulation-inspector-toggle"/);
  assert.match(html, /id="actor-inspector"/);
});
