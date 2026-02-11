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
  assert.match(html, /\.inspector-shell\s*\{[^}]*position:\s*sticky/);
  assert.match(html, /id="actor-inspector"/);
});
