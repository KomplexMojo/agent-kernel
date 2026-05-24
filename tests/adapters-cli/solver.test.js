const { spawnSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const ROOT = resolve(__dirname, "../..");
const cliPath = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const fixturePath = resolve(ROOT, "tests/fixtures/artifacts/solver-result-v1-basic.json");

test("cli solve supports solver fixture", () => {
  const nodePath = process.execPath;
  const outDir = mkdtempSync(join(tmpdir(), "agent-kernel-solve-cli-"));

  const result = spawnSync(nodePath, [cliPath, "solve", "--scenario", "test", "--solver-fixture", fixturePath, "--out-dir", outDir], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "solve command failed");
  }
});
