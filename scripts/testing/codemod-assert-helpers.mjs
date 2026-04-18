import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectTestInventory, ROOT, writeText } from "./shared.mjs";

function rewrite(source) {
  let next = source;
  next = next.replace(/require\("assert"\)/g, 'require("node:assert/strict")');
  next = next.replace(/require\('assert'\)/g, 'require("node:assert/strict")');
  next = next.replace(/from "assert";/g, 'from "node:assert/strict";');
  next = next.replace(/from 'assert';/g, 'from "node:assert/strict";');
  return next;
}

const files = (process.argv.length > 2 ? process.argv.slice(2) : collectTestInventory().files.map((entry) => entry.path))
  .map((entry) => resolve(ROOT, entry));

const changed = [];
for (const filePath of files) {
  const source = readFileSync(filePath, "utf8");
  const next = rewrite(source);
  if (next !== source) {
    writeText(filePath, next);
    changed.push(filePath);
  }
}

console.log(JSON.stringify({
  ok: true,
  changedCount: changed.length,
  changedFiles: changed,
}, null, 2));
