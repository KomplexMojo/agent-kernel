const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

function runCliExpectFailure(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("cli llm-plan writes build outputs with captured input artifact", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-"));
  runCli(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary.json",
      "--run-id",
      "run_llm_plan_fixture",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  const spec = JSON.parse(readFileSync(join(outDir, "spec.json"), "utf8"));
  assert.equal(spec.schema, "agent-kernel/BuildSpec");
  assert.equal(spec.meta.runId, "run_llm_plan_fixture");

  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const captureEntry = manifest.artifacts.find(
    (entry) => entry.schema === "agent-kernel/CapturedInputArtifact",
  );
  assert.ok(captureEntry);
  assert.equal(existsSync(join(outDir, captureEntry.path)), true);
  assert.ok(manifest.schemas.some((entry) => entry.schema === "agent-kernel/CapturedInputArtifact"));

  const capture = JSON.parse(readFileSync(join(outDir, captureEntry.path), "utf8"));
  assert.ok(capture.payload.prompt);
  assert.ok(capture.payload.responseRaw);
  assert.ok(capture.payload.responseParsed);
  assert.ok(capture.payload.summary);
  assert.equal(capture.payload.summary.dungeonTheme, "fire");

  const bundle = JSON.parse(readFileSync(join(outDir, "bundle.json"), "utf8"));
  assert.ok(bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/CapturedInputArtifact"));
});

test("cli llm-plan strict mode fails but writes capture with errors", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-strict-"));
  const runId = "run_llm_plan_strict";
  const result = runCliExpectFailure(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary-invalid.json",
      "--run-id",
      runId,
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1", AK_LLM_STRICT: "1" },
  );
  assert.notEqual(result.status, 0);

  const capturePath = join(outDir, `capture_llm_${runId}.json`);
  assert.equal(existsSync(capturePath), true);
  const capture = JSON.parse(readFileSync(capturePath, "utf8"));
  assert.ok(Array.isArray(capture.payload.errors));
  assert.ok(capture.payload.errors.length > 0);
});

test("cli llm-plan resilient mode sanitizes invalid affinities", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-resilient-"));
  runCli(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary-invalid.json",
      "--run-id",
      "run_llm_plan_resilient",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const captureEntry = manifest.artifacts.find(
    (entry) => entry.schema === "agent-kernel/CapturedInputArtifact",
  );
  assert.ok(captureEntry);
  const capture = JSON.parse(readFileSync(join(outDir, captureEntry.path), "utf8"));
  assert.equal(capture.payload.summary.rooms[0].affinities[0].kind, "fire");
  assert.equal(capture.payload.summary.rooms[0].affinities[0].expression, "push");
});

test("cli llm-plan supports prompt-only mode with catalog", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-prompt-"));
  runCli(
    [
      "llm-plan",
      "--prompt",
      "Plan a small fire dungeon.",
      "--catalog",
      "tests/fixtures/pool/catalog-basic.json",
      "--model",
      "fixture",
      "--goal",
      "Prompt-only goal",
      "--budget-tokens",
      "800",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary.json",
      "--run-id",
      "run_llm_plan_prompt",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  const spec = JSON.parse(readFileSync(join(outDir, "spec.json"), "utf8"));
  assert.equal(spec.intent.goal, "Prompt-only goal");
  assert.equal(spec.intent.hints.budgetTokens, 800);

  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const captureEntry = manifest.artifacts.find(
    (entry) => entry.schema === "agent-kernel/CapturedInputArtifact",
  );
  assert.ok(captureEntry);
  const capture = JSON.parse(readFileSync(join(outDir, captureEntry.path), "utf8"));
  assert.ok(capture.payload.prompt.includes("Budget tokens: 800"));
});

test("cli llm-plan falls back to scenario summary when AK_LLM_LIVE is off", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-fallback-"));
  runCli(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--run-id",
      "run_llm_plan_fallback",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "0" },
  );

  const spec = JSON.parse(readFileSync(join(outDir, "spec.json"), "utf8"));
  const intent = JSON.parse(readFileSync(join(outDir, "intent.json"), "utf8"));
  const plan = JSON.parse(readFileSync(join(outDir, "plan.json"), "utf8"));
  assert.equal(spec.meta.runId, "run_llm_plan_fallback");
  assert.equal(intent.schema, "agent-kernel/IntentEnvelope");
  assert.equal(plan.schema, "agent-kernel/PlanArtifact");

  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const captureEntry = manifest.artifacts.find(
    (entry) => entry.schema === "agent-kernel/CapturedInputArtifact",
  );
  assert.equal(captureEntry, undefined);
});

test("cli llm-plan rejects summaries that do not match catalog entries", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-mismatch-"));
  const result = runCliExpectFailure(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary-mismatch.json",
      "--run-id",
      "run_llm_plan_mismatch",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /did not match catalog entries/);
});
