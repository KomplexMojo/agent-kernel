const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

function runNodeTest(relativePath) {
  const result = spawnSync(process.execPath, ["--test", relativePath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
}

module.exports = {
  ROOT,
  runNodeTest,
  test,
};
