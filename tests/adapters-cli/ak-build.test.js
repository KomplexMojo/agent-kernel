const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync, readFileSync, realpathSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json");
const ADAPTER_SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-adapters.json");
const ADAPTER_REMOTE_SPEC = resolve(
  ROOT,
  "tests/fixtures/artifacts/build-spec-v1-adapters-llm-remote.json",
);
const BUDGET_INLINE_SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-budget-inline-only.json");
const CONFIG_SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");
const SOLVER_SPEC = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-solver.json");
const INVALID_SPEC = resolve(ROOT, "tests/fixtures/artifacts/invalid/build-spec-v1-missing-goal.json");

function runCli(args, { cwd, env } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function assertSortedSchemas(schemaEntries) {
  const names = schemaEntries.map((entry) => entry.schema);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted);
}

test("cli build accepts --spec and writes mapped artifacts", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-"));
  const result = runCli(["build", "--spec", SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "intent.json")), true);
  assert.equal(existsSync(join(outDir, "plan.json")), true);
});

test("cli build rejects unknown flags", () => {
  const result = runCli(["build", "--spec", SPEC, "--plan", "x"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /build only accepts --spec and --out-dir/);
});

test("cli build runs configurator inputs without executing core", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-config-"));
  const result = runCli(["build", "--spec", CONFIG_SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(outDir, "sim-config.json")), true);
  assert.equal(existsSync(join(outDir, "initial-state.json")), true);
  assert.equal(existsSync(join(outDir, "tick-frames.json")), false);
});

test("cli build writes a sorted manifest for emitted artifacts", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-manifest-"));
  const spec = JSON.parse(readFileSync(CONFIG_SPEC, "utf8"));
  const result = runCli(["build", "--spec", CONFIG_SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  assert.equal(manifest.specPath, "spec.json");
  assert.equal(manifest.correlation.runId, spec.meta.runId);
  assert.equal(manifest.correlation.source, spec.meta.source);
  assert.equal(Array.isArray(manifest.schemas), true);
  assertSortedSchemas(manifest.schemas);
  const expectedSchemas = new Set([spec.schema]);
  manifest.artifacts.forEach((entry) => expectedSchemas.add(entry.schema));
  const expectedSchemaNames = [...expectedSchemas].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(manifest.schemas.map((entry) => entry.schema), expectedSchemaNames);

  const sorted = [...manifest.artifacts].sort((a, b) => {
    if (a.schema === b.schema) {
      return a.id.localeCompare(b.id);
    }
    return a.schema.localeCompare(b.schema);
  });
  assert.deepEqual(manifest.artifacts, sorted);

  manifest.artifacts.forEach((entry) => {
    assert.equal(existsSync(join(outDir, entry.path)), true);
  });
});

test("cli build writes bundle.json with inlined artifacts", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-bundle-"));
  const result = runCli(["build", "--spec", CONFIG_SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  const bundle = JSON.parse(readFileSync(join(outDir, "bundle.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));

  assert.equal(bundle.spec.schema, "agent-kernel/BuildSpec");
  assert.equal(Array.isArray(bundle.artifacts), true);
  assert.equal(bundle.artifacts.length, manifest.artifacts.length);
  assert.deepEqual(bundle.schemas, manifest.schemas);

  const sorted = [...bundle.artifacts].sort((a, b) => {
    if (a.schema === b.schema) {
      return a.meta.id.localeCompare(b.meta.id);
    }
    return a.schema.localeCompare(b.schema);
  });
  assert.deepEqual(bundle.artifacts, sorted);

  bundle.artifacts.forEach((artifact, index) => {
    const entry = manifest.artifacts[index];
    const fromFile = JSON.parse(readFileSync(join(outDir, entry.path), "utf8"));
    assert.equal(artifact.schema, entry.schema);
    assert.equal(artifact.schemaVersion, entry.schemaVersion);
    assert.equal(artifact.meta.id, entry.id);
    assert.deepEqual(artifact, fromFile);
  });
});

test("cli build writes telemetry on success", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-telemetry-"));
  const result = runCli(["build", "--spec", CONFIG_SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  const telemetry = JSON.parse(readFileSync(join(outDir, "telemetry.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  assert.equal(telemetry.schema, "agent-kernel/TelemetryRecord");
  assert.equal(telemetry.scope, "run");
  assert.equal(telemetry.data.status, "success");
  const manifestRefs = manifest.artifacts.map((entry) => ({
    id: entry.id,
    schema: entry.schema,
    schemaVersion: entry.schemaVersion,
  }));
  assert.deepEqual(telemetry.data.artifactRefs, manifestRefs);
});

test("cli build writes telemetry on failure", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-telemetry-fail-"));
  const result = runCli(["build", "--spec", INVALID_SPEC, "--out-dir", outDir]);

  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(outDir, "manifest.json")), false);
  assert.equal(existsSync(join(outDir, "bundle.json")), false);
  const telemetry = JSON.parse(readFileSync(join(outDir, "telemetry.json"), "utf8"));
  assert.equal(telemetry.schema, "agent-kernel/TelemetryRecord");
  assert.equal(telemetry.scope, "run");
  assert.equal(telemetry.data.status, "error");
  assert.equal(Array.isArray(telemetry.data.errors), true);
  assert.ok(telemetry.data.errors[0].length > 0);
});

test("cli build runs solver with fixture hints", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-solver-"));
  const result = runCli(["build", "--spec", SOLVER_SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(outDir, "solver-request.json")), true);
  assert.equal(existsSync(join(outDir, "solver-result.json")), true);
  assert.equal(existsSync(join(outDir, "tick-frames.json")), false);
});

test("cli build writes inline budget artifacts when refs are absent", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-budget-inline-"));
  const result = runCli(["build", "--spec", BUDGET_INLINE_SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  const budgetPath = join(outDir, "budget.json");
  const priceListPath = join(outDir, "price-list.json");
  assert.equal(existsSync(budgetPath), true);
  assert.equal(existsSync(priceListPath), true);

  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  const priceList = JSON.parse(readFileSync(priceListPath, "utf8"));
  assert.equal(budget.schema, "agent-kernel/BudgetArtifact");
  assert.equal(priceList.schema, "agent-kernel/PriceList");

  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const schemas = manifest.artifacts.map((entry) => entry.schema);
  assert.ok(schemas.includes("agent-kernel/BudgetArtifact"));
  assert.ok(schemas.includes("agent-kernel/PriceList"));
});

test("cli build captures adapter outputs as captured input artifacts", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-capture-"));
  const result = runCli(["build", "--spec", ADAPTER_SPEC, "--out-dir", outDir]);

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const bundle = JSON.parse(readFileSync(join(outDir, "bundle.json"), "utf8"));

  const capturedEntries = manifest.artifacts.filter(
    (entry) => entry.schema === "agent-kernel/CapturedInputArtifact",
  );
  assert.equal(capturedEntries.length, 3);
  capturedEntries.forEach((entry) => {
    assert.equal(existsSync(join(outDir, entry.path)), true);
  });

  const captureArtifacts = bundle.artifacts.filter(
    (artifact) => artifact.schema === "agent-kernel/CapturedInputArtifact",
  );
  assert.equal(captureArtifacts.length, 3);
  assert.ok(bundle.schemas.some((entry) => entry.schema === "agent-kernel/CapturedInputArtifact"));

  const ipfsEntry = capturedEntries.find((entry) => entry.id === "capture_ipfs_price_list");
  assert.ok(ipfsEntry);
  assert.equal(ipfsEntry.path, "capture_ipfs_price_list.json");
  const ipfsArtifact = JSON.parse(readFileSync(join(outDir, ipfsEntry.path), "utf8"));
  assert.equal(ipfsArtifact.source.adapter, "ipfs");
  assert.equal(ipfsArtifact.contentType, "application/json");
  assert.equal(ipfsArtifact.payload.schema, "agent-kernel/PriceList");

  const defaultPaths = capturedEntries
    .filter((entry) => entry.id !== "capture_ipfs_price_list")
    .map((entry) => entry.path)
    .sort();
  assert.deepEqual(defaultPaths, ["captured-input-blockchain-2.json", "captured-input-llm-3.json"]);

  const blockchainArtifact = captureArtifacts.find((artifact) => artifact.source.adapter === "blockchain");
  assert.ok(blockchainArtifact);
  assert.equal(blockchainArtifact.payload.address, "0xabc");
  assert.equal(blockchainArtifact.payload.chainId, "0x1");
  assert.equal(blockchainArtifact.payload.balance, "0x10");

  const llmArtifact = captureArtifacts.find((artifact) => artifact.source.adapter === "llm");
  assert.ok(llmArtifact);
  assert.equal(llmArtifact.payload.response, "ok");
});

test("cli build allows local llm baseUrl without AK_ALLOW_NETWORK", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-local-llm-"));
  const result = runCli(
    ["build", "--spec", ADAPTER_SPEC, "--out-dir", outDir],
    { env: { AK_ALLOW_NETWORK: "0" } },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("cli build blocks non-local llm baseUrl without AK_ALLOW_NETWORK", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-remote-llm-"));
  const result = runCli(
    ["build", "--spec", ADAPTER_REMOTE_SPEC, "--out-dir", outDir],
    { env: { AK_ALLOW_NETWORK: "0" } },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /llm capture requires fixturePath unless AK_ALLOW_NETWORK=1/);
});

test("cli build defaults to artifacts/runs/<runId>/build under cwd", () => {
  const workDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-build-default-"));
  const spec = JSON.parse(readFileSync(SPEC, "utf8"));
  const result = runCli(["build", "--spec", SPEC], { cwd: workDir });

  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/build: wrote (.+)\n?/);
  assert.ok(match, "Expected build output path in stdout");
  const outDir = realpathSync(match[1].trim());
  const expectedDir = realpathSync(join(workDir, "artifacts", "runs", spec.meta.runId, "build"));
  assert.equal(outDir, expectedDir);
  assert.equal(existsSync(join(outDir, "spec.json")), true);
  assert.equal(existsSync(join(outDir, "intent.json")), true);
  assert.equal(existsSync(join(outDir, "plan.json")), true);
});
