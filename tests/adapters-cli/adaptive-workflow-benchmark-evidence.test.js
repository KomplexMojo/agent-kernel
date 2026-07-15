const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const FIXTURE_DIR = join(__dirname, "../fixtures/adaptive-workflow");
const AS_OF = "2026-07-13T00:00:00.000Z";
const STRATEGY_BY_PROFILE = { dual: "flagship_full_context_v1" };

async function loadLoader() { return import("../../packages/adapters-cli/src/adapters/adaptive-workflow/benchmark-evidence-loader.js"); }
async function loadEvidence() { return import("../../packages/runtime/src/adaptive-workflow/benchmark-evidence.js"); }
async function loadPolicy() { return import("../../packages/runtime/src/adaptive-workflow/strategy-policy.js"); }
async function loadProfiles() { return import("../../packages/runtime/src/adaptive-workflow/profiles.js"); }

test("loads a content-gen summary into accepted benchmark evidence", async () => {
  const { loadBenchmarkEvidenceFromSummary } = await loadLoader();
  const loaded = loadBenchmarkEvidenceFromSummary(join(FIXTURE_DIR, "benchmark-summary-v1-basic.md"), {
    strategyIdByProfile: STRATEGY_BY_PROFILE,
    asOf: AS_OF,
  });
  assert.equal(loaded.generatedAt, "2026-07-12T16:56:07.611Z");
  assert.equal(loaded.evidence.length, 1);
  const [evidence] = loaded.evidence;
  assert.equal(evidence.schema, "agent-kernel/BenchmarkEvidence");
  assert.equal(evidence.strategyId, "flagship_full_context_v1");
  assert.equal(evidence.sampleSize, 192);
  assert.equal(evidence.averageScore, 70);
  assert.ok(evidence.stability >= 0.95 && evidence.stability <= 1);
  assert.ok(evidence.confidence > 0 && evidence.confidence <= 1);
  assert.equal(loaded.classifications[0].status, "accepted");
  assert.equal(loaded.classifications[0].reason, "accepted");
});

test("marks stale and insufficient summaries machine-readably", async () => {
  const { loadBenchmarkEvidenceFromSummary } = await loadLoader();
  const stale = loadBenchmarkEvidenceFromSummary(join(FIXTURE_DIR, "benchmark-summary-v1-stale.md"), { strategyIdByProfile: STRATEGY_BY_PROFILE, asOf: AS_OF });
  assert.equal(stale.classifications[0].status, "ignored");
  assert.equal(stale.classifications[0].reason, "stale");

  const insufficient = loadBenchmarkEvidenceFromSummary(join(FIXTURE_DIR, "benchmark-summary-v1-insufficient.md"), { strategyIdByProfile: STRATEGY_BY_PROFILE, asOf: AS_OF });
  assert.equal(insufficient.classifications[0].status, "ignored");
  assert.equal(insufficient.classifications[0].reason, "insufficient_sample_size");
});

test("loaded evidence alone never mutates the active strategy policy", async () => {
  const { loadBenchmarkEvidenceFromSummary } = await loadLoader();
  const { createStrategyPolicyV1, selectStrategy } = await loadPolicy();
  const { createDeclaredModelCapabilityV1 } = await loadProfiles();
  const policy = createStrategyPolicyV1();
  const before = JSON.stringify(policy);
  const loaded = loadBenchmarkEvidenceFromSummary(join(FIXTURE_DIR, "benchmark-summary-v1-basic.md"), { strategyIdByProfile: STRATEGY_BY_PROFILE, asOf: AS_OF });
  const declaredCapability = createDeclaredModelCapabilityV1({ schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", contextWindowTokens: 128000, maxOutputTokens: 4096, supports: { textGeneration: true, structuredOutput: true, streaming: false } });
  const selected = selectStrategy({ declaredCapability, benchmarkEvidence: loaded.evidence, policy, asOf: AS_OF });
  assert.equal(JSON.stringify(policy), before);
  assert.equal(selected.strategyId, "flagship_full_context_v1");
});

test("explicit promotion produces a new versioned policy without mutating the source", async () => {
  const { promoteBenchmarkPolicy } = await loadEvidence();
  const { createStrategyPolicyV1, selectStrategy } = await loadPolicy();
  const { createDeclaredModelCapabilityV1 } = await loadProfiles();
  const basePolicy = createStrategyPolicyV1();
  const before = JSON.stringify(basePolicy);
  const promoted = promoteBenchmarkPolicy({
    policy: basePolicy,
    promotions: [{ strategyId: "flagship_full_context_v1", required: true, minAverageScore: 75 }],
    asOf: AS_OF,
  });
  assert.equal(JSON.stringify(basePolicy), before, "source policy must not mutate");
  assert.notEqual(promoted.policyVersion, basePolicy.policyVersion);
  assert.equal(promoted.provenance.source, "benchmark-promotion");
  const flagship = promoted.strategies.find((strategy) => strategy.id === "flagship_full_context_v1");
  assert.deepEqual(flagship.benchmark, { required: true, minAverageScore: 75 });

  const declaredCapability = createDeclaredModelCapabilityV1({ schemaVersion: 1, providerId: "fixture", modelId: "fixture", source: "declared", contextWindowTokens: 128000, maxOutputTokens: 4096, supports: { textGeneration: true, structuredOutput: true, streaming: false } });
  // Under the promoted policy the flagship is gated behind qualifying evidence, so
  // an evidence-free selection makes it ineligible and falls back to local sectional repair.
  const withoutEvidence = selectStrategy({ declaredCapability, policy: promoted, asOf: AS_OF });
  assert.equal(withoutEvidence.strategyId, "local_sectional_repair_v1");
  assert.equal(withoutEvidence.candidates.find((candidate) => candidate.strategyId === "flagship_full_context_v1").eligible, false);
  assert.ok(withoutEvidence.candidates.find((candidate) => candidate.strategyId === "flagship_full_context_v1").reasons.includes("missing_benchmark_evidence"));
});

// ## TODO: Test Permutations
// - summary with multiple profile rows yields one evidence entry per profile
// - malformed aggregate table rows are skipped with a recorded reason
// - unmapped profile names are reported rather than silently strategy-less
// - future-dated summaries classify as future_timestamp
