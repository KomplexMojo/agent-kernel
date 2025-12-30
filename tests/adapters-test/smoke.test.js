const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

const FILES = [
  "packages/adapters-test/src/adapters/ipfs/index.js",
  "packages/adapters-test/src/adapters/blockchain/index.js",
  "packages/adapters-test/src/adapters/llm/index.js",
];

test("adapters-test entrypoints exist", () => {
  for (const file of FILES) {
    assert.ok(existsSync(resolve(ROOT, file)), `Missing ${file}`);
  }
});
