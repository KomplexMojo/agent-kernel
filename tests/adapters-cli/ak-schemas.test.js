const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const FIXED_TIME = "2000-01-01T00:00:00.000Z";

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

function assertSortedSchemas(catalog) {
  const names = catalog.schemas.map((entry) => entry.schema);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted);
}

test("cli schemas prints catalog to stdout", () => {
  const result = runCli(["schemas"], { env: { AK_SCHEMA_CATALOG_TIME: FIXED_TIME } });

  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.stdout);
  assert.equal(catalog.generatedAt, FIXED_TIME);
  assertSortedSchemas(catalog);

  const names = catalog.schemas.map((entry) => entry.schema);
  assert.ok(names.includes("agent-kernel/BuildSpec"));
  assert.ok(names.includes("agent-kernel/IntentEnvelope"));
  assert.ok(names.includes("agent-kernel/SimConfigArtifact"));
  assert.ok(names.includes("agent-kernel/InitialStateArtifact"));
  assert.ok(names.includes("agent-kernel/TelemetryRecord"));
});

test("cli schemas writes schemas.json when --out-dir is provided", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-schemas-"));
  const result = runCli(["schemas", "--out-dir", outDir], { env: { AK_SCHEMA_CATALOG_TIME: FIXED_TIME } });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /schemas: wrote/);

  const catalog = JSON.parse(readFileSync(join(outDir, "schemas.json"), "utf8"));
  assert.equal(catalog.generatedAt, FIXED_TIME);
  assertSortedSchemas(catalog);
});
