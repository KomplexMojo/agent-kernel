const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
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
  assert.ok(capture.payload.phaseTiming?.startedAt);
  assert.ok(capture.payload.phaseTiming?.endedAt);
  assert.equal(typeof capture.payload.phaseTiming?.durationMs, "number");

  const bundle = JSON.parse(readFileSync(join(outDir, "bundle.json"), "utf8"));
  assert.ok(bundle.artifacts.some((artifact) => artifact.schema === "agent-kernel/CapturedInputArtifact"));
});

test("cli llm-plan budget loop writes multiple captures", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-loop-"));
  runCli(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary-budget-loop.json",
      "--budget-loop",
      "--run-id",
      "run_llm_plan_loop",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const captureEntries = manifest.artifacts.filter(
    (entry) => entry.schema === "agent-kernel/CapturedInputArtifact",
  );
  assert.equal(captureEntries.length, 2);
  assert.ok(
    manifest.artifacts.some((entry) => entry.schema === "agent-kernel/BudgetAllocationArtifact"),
  );
  const captureA = JSON.parse(readFileSync(join(outDir, captureEntries[0].path), "utf8"));
  const captureB = JSON.parse(readFileSync(join(outDir, captureEntries[1].path), "utf8"));
  assert.equal(captureA.payload.phase, "layout_only");
  assert.equal(captureB.payload.phase, "actors_only");
  assert.ok(captureA.payload.phaseTiming?.startedAt);
  assert.ok(captureA.payload.phaseTiming?.endedAt);
  assert.equal(typeof captureA.payload.phaseTiming?.durationMs, "number");
  assert.ok(captureB.payload.phaseTiming?.startedAt);
  assert.ok(captureB.payload.phaseTiming?.endedAt);
  assert.equal(typeof captureB.payload.phaseTiming?.durationMs, "number");

  const telemetry = JSON.parse(readFileSync(join(outDir, "telemetry.json"), "utf8"));
  const trace = telemetry?.data?.llm?.trace || [];
  assert.ok(Array.isArray(trace));
  assert.equal(trace[0].phase, "layout_only");
  assert.equal(trace[0].spentTokens, 200);
  assert.equal(trace[0].remainingBudgetTokens, 440);
  assert.ok(trace[0].startedAt);
  assert.ok(trace[0].endedAt);
  assert.equal(typeof trace[0].durationMs, "number");
  const allocation = telemetry?.data?.llm?.budgetAllocation;
  assert.ok(allocation);
  const poolsById = Object.fromEntries(allocation.pools.map((pool) => [pool.id, pool.tokens]));
  assert.equal(poolsById.layout, 320);
  assert.equal(poolsById.defenders, 320);
  assert.equal(poolsById.player, 160);
});

test("cli llm-plan budget loop writes feasibility warnings into telemetry", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-loop-warn-"));
  runCli(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary-budget-loop-feasibility.json",
      "--budget-loop",
      "--run-id",
      "run_llm_plan_loop_warn",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  const telemetry = JSON.parse(readFileSync(join(outDir, "telemetry.json"), "utf8"));
  const trace = telemetry?.data?.llm?.trace || [];
  assert.ok(Array.isArray(trace));
  assert.ok(
    trace.some((entry) =>
      Array.isArray(entry.validationWarnings)
        && entry.validationWarnings.some((warn) => warn.code === "insufficient_walkable_tiles")
    )
  );
});

test("cli llm-plan budget loop honors custom budget pools", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-loop-pools-"));
  runCli(
    [
      "llm-plan",
      "--scenario",
      "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary-budget-loop.json",
      "--budget-loop",
      "--budget-pool",
      "player=0",
      "--budget-pool",
      "layout=0.5",
      "--budget-pool",
      "defenders=0.5",
      "--budget-pool",
      "loot=0",
      "--run-id",
      "run_llm_plan_loop_pools",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  const telemetry = JSON.parse(readFileSync(join(outDir, "telemetry.json"), "utf8"));
  const allocation = telemetry?.data?.llm?.budgetAllocation;
  const poolsById = Object.fromEntries(allocation.pools.map((pool) => [pool.id, pool.tokens]));
  assert.equal(poolsById.layout, 400);
  assert.equal(poolsById.defenders, 400);
  assert.equal(poolsById.player, 0);

  const trace = telemetry?.data?.llm?.trace || [];
  assert.equal(trace[0].remainingBudgetTokens, 600);
});

test("cli llm-plan budget loop requires budget tokens", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-loop-missing-budget-"));
  const scenarioPath = join(outDir, "scenario-missing-budget.json");
  const scenario = {
    schema: "agent-kernel/E2EScenario",
    schemaVersion: 1,
    goal: "Missing budget tokens",
    tier: 1,
    levelSize: { width: 5, height: 5 },
    actorCount: 1,
    catalogPath: "tests/fixtures/pool/catalog-basic.json",
    summaryPath: "tests/fixtures/e2e/summary-v1-basic.json",
  };
  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2));

  const result = runCliExpectFailure(
    [
      "llm-plan",
      "--scenario",
      scenarioPath,
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary-budget-loop.json",
      "--budget-loop",
      "--run-id",
      "run_llm_plan_missing_budget",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /llm-plan requires --budget-tokens/i);
});

test("cli llm-plan requires budget tokens in single-pass mode", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-plan-missing-budget-"));
  const scenarioPath = join(outDir, "scenario-missing-budget.json");
  const scenario = {
    schema: "agent-kernel/E2EScenario",
    schemaVersion: 1,
    goal: "Missing budget tokens",
    tier: 1,
    levelSize: { width: 5, height: 5 },
    actorCount: 1,
    catalogPath: "tests/fixtures/pool/catalog-basic.json",
    summaryPath: "tests/fixtures/e2e/summary-v1-basic.json",
  };
  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2));

  const result = runCliExpectFailure(
    [
      "llm-plan",
      "--scenario",
      scenarioPath,
      "--model",
      "fixture",
      "--fixture",
      "tests/fixtures/adapters/llm-generate-summary.json",
      "--run-id",
      "run_llm_plan_missing_budget_single",
      "--created-at",
      "2025-01-01T00:00:00Z",
      "--out-dir",
      outDir,
    ],
    { AK_LLM_LIVE: "1" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /llm-plan requires --budget-tokens/i);
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
