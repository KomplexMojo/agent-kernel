const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

const FILES = [
  "packages/bindings-ts/src/index.js",
  "packages/bindings-ts/src/core-as.js",
];

test("bindings entrypoints exist", () => {
  for (const file of FILES) {
    assert.ok(existsSync(resolve(ROOT, file)), `Missing ${file}`);
  }
});
