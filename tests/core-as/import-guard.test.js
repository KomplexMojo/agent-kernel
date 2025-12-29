const test = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { resolve, join } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CORE_DIR = resolve(ROOT, "packages/core-as/assembly");

function listFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function findExternalImports(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const external = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import")) {
      continue;
    }
    const match = trimmed.match(/import\s+.*from\s+["']([^"']+)["']/);
    const sideEffectMatch = trimmed.match(/import\s+["']([^"']+)["']/);
    const target = match?.[1] || sideEffectMatch?.[1];
    if (target && !target.startsWith(".")) {
      external.push(target);
    }
  }
  return external;
}

test("core-as has no external imports", () => {
  assert.ok(statSync(CORE_DIR).isDirectory());
  const files = listFiles(CORE_DIR);
  const offenders = [];
  for (const file of files) {
    const external = findExternalImports(file);
    if (external.length > 0) {
      offenders.push({ file, external });
    }
  }
  assert.deepEqual(offenders, []);
});
