const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

const FILES = [
  "packages/core-ts/src/index.ts",
  "packages/core-ts/src/mvp-movement.ts",
];

test("core-ts entrypoints exist", () => {
  for (const file of FILES) {
    assert.ok(existsSync(resolve(ROOT, file)), `Missing ${file}`);
  }
});
