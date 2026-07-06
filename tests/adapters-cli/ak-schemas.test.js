const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
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
  assert.ok(names.includes("agent-kernel/AgentCommandRequestArtifact"));
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

test("cli schemas without --out-dir emits parseable stdout and writes no file", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-schemas-stdout-"));
  const result = runCli(["schemas"], { env: { AK_SCHEMA_CATALOG_TIME: FIXED_TIME } });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.equal(existsSync(join(outDir, "schemas.json")), false);
});

test("cli schemas overwrites the same --out-dir idempotently", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-schemas-overwrite-"));
  const stalePath = join(outDir, "schemas.json");
  writeFileSync(stalePath, "{\"stale\":true}\n", "utf8");

  const first = runCli(["schemas", "--out-dir", outDir], { env: { AK_SCHEMA_CATALOG_TIME: "2001-01-01T00:00:00.000Z" } });
  const second = runCli(["schemas", "--out-dir", outDir], { env: { AK_SCHEMA_CATALOG_TIME: "2002-01-01T00:00:00.000Z" } });
  const catalog = JSON.parse(readFileSync(stalePath, "utf8"));

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(catalog.generatedAt, "2002-01-01T00:00:00.000Z");
  assert.equal(catalog.stale, undefined);
});

test("cli schemas catalog includes key artifact schemas referenced by contracts", () => {
  const result = runCli(["schemas"], { env: { AK_SCHEMA_CATALOG_TIME: FIXED_TIME } });
  const catalog = JSON.parse(result.stdout);
  const names = new Set(catalog.schemas.map((entry) => entry.schema));

  [
    "agent-kernel/BudgetArtifact",
    "agent-kernel/BudgetReceiptArtifact",
    "agent-kernel/PriceList",
    "agent-kernel/SandboxSessionArtifact",
    "agent-kernel/TickFrame",
  ].forEach((schema) => assert.ok(names.has(schema), `${schema} missing from catalog`));
});

test("cli schemas without fixed time produces an ISO timestamp", () => {
  const result = runCli(["schemas"]);
  const catalog = JSON.parse(result.stdout);

  assert.match(catalog.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("cli schemas catalog ordering is stable across runs", () => {
  const first = JSON.parse(runCli(["schemas"], { env: { AK_SCHEMA_CATALOG_TIME: FIXED_TIME } }).stdout);
  const second = JSON.parse(runCli(["schemas"], { env: { AK_SCHEMA_CATALOG_TIME: FIXED_TIME } }).stdout);

  assert.deepEqual(first.schemas.map((entry) => entry.schema), second.schemas.map((entry) => entry.schema));
  assertSortedSchemas(first);
});
