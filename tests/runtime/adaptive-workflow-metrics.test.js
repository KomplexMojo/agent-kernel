const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const OK_SUMMARY = { rooms: [{ id: "r1" }], actors: [{ id: "a1" }] };
const capability = {
  schemaVersion: 1,
  providerId: "fixture-provider",
  modelId: "fixture",
  source: "declared",
  providerContextWindowTokens: 128000,
  contextWindowTokens: 128000,
  maxOutputTokens: 4096,
  supports: { textGeneration: true, structuredOutput: true, streaming: false },
};

function clock() {
  let i = 0;
  return () => `2026-07-12T00:00:${String(++i).padStart(2, "0")}.000Z`;
}

function model(responses, calls = []) {
  return {
    async generate(request) {
      calls.push(request);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || { response: "" };
    },
  };
}

function validator(okAfter = 1) {
  let calls = 0;
  return {
    id: "fixture-validator",
    version: 1,
    validate(value) {
      calls += 1;
      const ok = calls >= okAfter && Boolean(value?.rooms?.length);
      return ok ? { ok: true } : { ok: false, issues: [{ code: "domain_invalid", message: "not valid" }] };
    },
  };
}

async function loadMetrics() { return import("../../packages/runtime/src/adaptive-workflow/metrics.js"); }
async function loadRunner() { return import("../../packages/runtime/src/adaptive-workflow/runner.js"); }

test("summarizes a completed run with required Prompt.md fields", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const { summarizeAdaptiveWorkflowMetrics } = await loadMetrics();
  const result = await runAdaptiveWorkflow({
    objective: "build flagship",
    runId: "run_metrics",
    declaredCapability: capability,
    ports: { model: model([{ response: JSON.stringify(OK_SUMMARY) }]), validator: [validator(1)], clock: clock() },
  });

  const metrics = summarizeAdaptiveWorkflowMetrics({
    state: result.state,
    captures: result.captures,
    selectedStrategy: result.selectedStrategy,
    model: "fixture",
    provider: "fixture-provider",
    clock: () => "2026-07-12T00:01:00.000Z",
  });

  assert.equal(metrics.schema, "agent-kernel/AdaptiveWorkflowMetrics");
  assert.equal(metrics.schemaVersion, 1);
  assert.equal(metrics.runId, "run_metrics");
  assert.equal(metrics.meta.runId, "run_metrics");
  assert.equal(metrics.outcome, "complete");
  assert.equal(metrics.model, "fixture");
  assert.equal(metrics.provider, "fixture-provider");
  assert.equal(metrics.selectedStrategy.strategyId, "flagship_full_context_v1");
  assert.equal(metrics.selectedStrategy.policyVersion, "adaptive-workflow-strategy-policy-v1");
  assert.deepEqual(metrics.phaseTransitions.map((entry) => entry.phase), ["plan", "configure", "validate", "execute", "verify", "complete"]);
  assert.equal(metrics.validations.passed, 2);
  assert.equal(metrics.validations.failed, 0);
  assert.equal(metrics.prompts.count, 1);
  assert.equal(metrics.responses.count, 1);
  assert.match(metrics.prompts.hashes[0], /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(metrics.latency.samples, 1);
  assert.ok(Number.isInteger(metrics.latency.totalMs));
  assert.equal(metrics.tokenUsage, null);
  assert.equal(metrics.redactions, 0);
  assert.ok(Object.isFrozen(metrics));
  assert.doesNotThrow(() => JSON.stringify(metrics));
});

test("runner result exposes inline metrics for the run", async () => {
  const { runAdaptiveWorkflow } = await loadRunner();
  const result = await runAdaptiveWorkflow({
    objective: "inline metrics",
    runId: "run_inline",
    declaredCapability: capability,
    ports: { model: model([{ response: JSON.stringify(OK_SUMMARY) }]), validator: [validator(1)], clock: clock() },
  });
  assert.equal(result.metrics.runId, "run_inline");
  assert.equal(result.metrics.outcome, "complete");
  assert.equal(result.metrics.selectedStrategy.strategyId, "flagship_full_context_v1");
});

test("aggregates token usage when captures carry usage counts", async () => {
  const { summarizeAdaptiveWorkflowMetrics } = await loadMetrics();
  const metrics = summarizeAdaptiveWorkflowMetrics({
    state: { runId: "run_tokens", phase: "complete", events: [] },
    captures: [
      { payload: { prompt: "p1", responseRaw: "r1", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, phaseTiming: { durationMs: 12 } } },
      { payload: { prompt: "p2", responseRaw: "r2", usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 } } },
    ],
    clock: () => "2026-07-12T00:01:00.000Z",
  });
  assert.deepEqual(metrics.tokenUsage, { promptTokens: 14, completionTokens: 11, totalTokens: 25, samples: 2 });
  assert.equal(metrics.latency.samples, 1);
  assert.equal(metrics.latency.totalMs, 12);
});

test("redacts secret-shaped values and never copies them into output", async () => {
  const { summarizeAdaptiveWorkflowMetrics } = await loadMetrics();
  const metrics = summarizeAdaptiveWorkflowMetrics({
    state: {
      runId: "run_secret",
      phase: "complete",
      events: [
        { phase: "plan", kind: "phase_transition", occurredAt: "2026-07-12T00:00:01.000Z", details: { authorization: "Bearer sk-topsecret-token" } },
      ],
    },
    captures: [
      { payload: { prompt: "make a room", responseRaw: "{}", phaseTiming: { durationMs: 5 } }, source: { request: { model: "fixture", options: { apiKey: "sk-should-not-leak" } } } },
    ],
    model: "fixture",
    clock: () => "2026-07-12T00:01:00.000Z",
  });
  const serialized = JSON.stringify(metrics);
  assert.doesNotMatch(serialized, /sk-topsecret-token/);
  assert.doesNotMatch(serialized, /sk-should-not-leak/);
  assert.ok(metrics.redactions >= 2, `expected >=2 redactions, got ${metrics.redactions}`);
});

test("metrics module avoids direct IO, environment, network, and wall-clock reads", () => {
  const source = readFileSync(join(__dirname, "../../packages/runtime/src/adaptive-workflow/metrics.js"), "utf8");
  assert.doesNotMatch(source, /\b(Date\.now|process\.|fetch\(|XMLHttpRequest|readFile|writeFile|require\(|node:crypto|createHash)\b/);
});

// ## TODO: Test Permutations
// - missing token usage across all captures yields null tokenUsage
// - failed and cancelled runs still summarize outcome and partial latency
// - repair actions and side-effect receipts are counted from events
// - nested env-like keys inside details are redacted and counted
