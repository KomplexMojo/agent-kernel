const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

const FILES = [
  "packages/runtime/src/runner/runtime.js",
  "packages/runtime/src/ports/budget.js",
  "packages/runtime/src/ports/solver.js",
  "packages/runtime/src/ports/effects.js",
  "packages/runtime/src/contracts/budget-categories.js",
  "packages/runtime/src/index.js",
];

test("runtime entrypoints exist", () => {
  for (const file of FILES) {
    assert.ok(existsSync(resolve(ROOT, file)), `Missing ${file}`);
  }
});
