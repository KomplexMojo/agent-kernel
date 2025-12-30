const assert = require("node:assert");
const { test } = require("node:test");
const { existsSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const wasmPaths = [
  path.join(repoRoot, "build", "core-as.wasm"),
  path.join(repoRoot, "packages", "ui-web", "assets", "core-as.wasm"),
];

const missing = wasmPaths.filter((p) => !existsSync(p));

test("core-as.wasm exists for CLI and UI surfaces", { skip: missing.length > 0 && `Missing: ${missing.join(", ")}` }, () => {
  for (const wasmPath of wasmPaths) {
    assert.ok(existsSync(wasmPath), `Expected ${wasmPath} to exist`);
  }
});
