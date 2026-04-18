import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectTestInventory, ROOT, writeText } from "./shared.mjs";

function convertSource(source) {
  let next = source;
  next = next.replace(/^const test = require\("node:test"\);\n/gm, "");
  next = next.replace(/^const \{[^}]+\} = require\("node:test"\);\n/gm, "");
  next = next.replace(/^import \{[^}]+\} from "node:test";\n/gm, "");
  next = next.replace(/^import \{[^}]+\} from 'node:test';\n/gm, "");
  next = next.replace(/^const \{[^}]+\} = require\("vitest"\);\n/gm, "");
  next = next.replace(/^import \{[^}]+\} from "vitest";\n/gm, "");
  next = next.replace(/^import \{[^}]+\} from 'vitest';\n/gm, "");
  next = next.replace(/test\.before\(/g, "beforeAll(");
  next = next.replace(/test\.after\(/g, "afterAll(");
  return next;
}

function shouldSkip(source) {
  return source.includes("t.after(");
}

const explicitFiles = process.argv.slice(2);
const files = explicitFiles.length > 0
  ? explicitFiles.map((entry) => resolve(ROOT, entry))
  : collectTestInventory()
    .files
    .map((entry) => entry.path)
    .filter((entry) => entry.endsWith(".test.js") || entry.endsWith(".test.mjs"))
    .map((entry) => resolve(ROOT, entry));

const changed = [];
const skipped = [];
for (const filePath of files) {
  const source = readFileSync(filePath, "utf8");
  if (shouldSkip(source)) {
    skipped.push(filePath);
    continue;
  }
  const next = convertSource(source);
  if (next !== source) {
    writeText(filePath, next);
    changed.push(filePath);
  }
}

console.log(JSON.stringify({
  ok: true,
  changedCount: changed.length,
  changedFiles: changed,
  skippedCount: skipped.length,
  skippedFiles: skipped,
}, null, 2));
