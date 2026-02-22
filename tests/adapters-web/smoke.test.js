const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

const FILES = [
  "packages/adapters-web/src/adapters/dom-log.js",
  "packages/adapters-web/src/adapters/solver-wasm.js",
  "packages/adapters-web/src/adapters/ipfs/index.js",
  "packages/adapters-web/src/adapters/blockchain/index.js",
  "packages/adapters-web/src/adapters/llm/index.js",
  "packages/adapters-web/src/adapters/level-builder/index.js",
  "packages/adapters-web/src/adapters/level-builder/worker.js",
];

test("adapters-web entrypoints exist", () => {
  for (const file of FILES) {
    assert.ok(existsSync(resolve(ROOT, file)), `Missing ${file}`);
  }
});
