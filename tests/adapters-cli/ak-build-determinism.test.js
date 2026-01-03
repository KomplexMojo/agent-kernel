const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json");

function runCli(args, { cwd } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || ROOT,
    encoding: "utf8",
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("cli build outputs deterministic manifest/bundle/telemetry", () => {
  const outDirA = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-det-a-"));
  const outDirB = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-det-b-"));

  const resultA = runCli(["build", "--spec", SPEC, "--out-dir", outDirA]);
  const resultB = runCli(["build", "--spec", SPEC, "--out-dir", outDirB]);

  assert.equal(resultA.status, 0, resultA.stderr);
  assert.equal(resultB.status, 0, resultB.stderr);

  const manifestA = readJson(join(outDirA, "manifest.json"));
  const manifestB = readJson(join(outDirB, "manifest.json"));
  const bundleA = readJson(join(outDirA, "bundle.json"));
  const bundleB = readJson(join(outDirB, "bundle.json"));
  const telemetryA = readJson(join(outDirA, "telemetry.json"));
  const telemetryB = readJson(join(outDirB, "telemetry.json"));

  assert.deepEqual(manifestA, manifestB);
  assert.deepEqual(bundleA, bundleB);
  assert.deepEqual(telemetryA, telemetryB);
});
