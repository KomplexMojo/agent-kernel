const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const FIXTURE_DIR = join(__dirname, "../fixtures/adaptive-workflow");
const AS_OF = "2026-07-12T00:00:00.000Z";

function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
}
const strategy = (id, extra = {}) => ({ id, precedence: 1, score: 1, minContextTokens: 1, requires: { textGeneration: true }, resourcePolicy: { maxConcurrency: 1, candidateCount: 1, routing: id }, ...extra });

async function loadM4() {
  const [profiles, policy, budget] = await Promise.all([
    import("../../packages/runtime/src/adaptive-workflow/profiles.js"),
    import("../../packages/runtime/src/adaptive-workflow/strategy-policy.js"),
    import("../../packages/runtime/src/adaptive-workflow/context-budget.js"),
  ]);
  return { ...profiles, ...policy, ...budget };
}

test("strategy policy selects flagship when declared and runtime capabilities are eligible", async () => {
  const { createBenchmarkEvidenceV1, createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1, selectStrategy } = await loadM4();
  const declaredCapability = createDeclaredModelCapabilityV1(fixture("model-capabilities-v1-basic.json"));
  const runtimeProfile = createRuntimeProfileSnapshotV1({
    ...fixture("runtime-profile-v1-local.json"),
    capabilities: { ...fixture("runtime-profile-v1-local.json").capabilities, maxContextTokens: 128000 },
  });
  const policy = createStrategyPolicyV1();
  const selected = selectStrategy({
    declaredCapability,
    runtimeProfile,
    benchmarkEvidence: [createBenchmarkEvidenceV1({ evidenceId: "evidence_flagship", strategyId: "flagship_full_context_v1", sampleSize: 50, stability: 0.96, confidence: 0.91, capturedAt: "2026-07-11T00:00:00.000Z", source: "fixture-benchmark" })],
    policy,
    asOf: AS_OF,
  });
  assert.equal(selected.strategyId, "flagship_full_context_v1");
  assert.equal(selected.policyVersion, policy.policyVersion);
  assert.equal(policy.policyVersion, "adaptive-workflow-strategy-policy-v1");
  assert.equal(selected.provenance.evidence[0].status, "accepted");
  assert.equal(selected.provenance.evidence[0].ageMs, 86400000);
  assert.equal(selected.provenance.evidence[0].source, "fixture-benchmark");
  assert.equal(selected.candidates[0].strategyId, "flagship_full_context_v1");
  assert.ok(Object.isFrozen(selected));
  assert.deepEqual(JSON.parse(JSON.stringify(selected)).strategyId, "flagship_full_context_v1");
});

test("strategy policy falls back to local sectional repair under constrained capability", async () => {
  const { createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1, selectStrategy } = await loadM4();
  const declaredCapability = createDeclaredModelCapabilityV1({
    ...fixture("model-capabilities-v1-basic.json"),
    contextWindowTokens: 24000,
    maxOutputTokens: 2048,
    supports: { textGeneration: true, structuredOutput: false, streaming: false },
  });
  const runtimeProfile = createRuntimeProfileSnapshotV1(fixture("runtime-profile-v1-local.json"));
  const selected = selectStrategy({ declaredCapability, runtimeProfile, policy: createStrategyPolicyV1(), asOf: AS_OF });

  assert.equal(selected.strategyId, "local_sectional_repair_v1");
  assert.equal(selected.candidates.find((item) => item.strategyId === "flagship_full_context_v1").eligible, false);
  assert(selected.provenance.reasons.includes("fallback_order"));
});

test("equal strategy scores use explicit deterministic tie-breaking", async () => {
  const { createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1, selectStrategy } = await loadM4();
  const policy = createStrategyPolicyV1({
    strategies: [strategy("beta_equal_v1", { precedence: 10, score: 80, minContextTokens: 1000 }), strategy("alpha_equal_v1", { precedence: 10, score: 80, minContextTokens: 1000 })],
    fallbackOrder: ["beta_equal_v1", "alpha_equal_v1"],
  });
  const selected = selectStrategy({
    declaredCapability: createDeclaredModelCapabilityV1(fixture("model-capabilities-v1-basic.json")),
    runtimeProfile: createRuntimeProfileSnapshotV1(fixture("runtime-profile-v1-local.json")),
    policy,
    asOf: AS_OF,
  });
  assert.equal(selected.strategyId, "beta_equal_v1");
  assert.deepEqual(selected.provenance.tieBreakers, ["score_desc", "precedence_asc", "fallback_order", "strategy_id"]);
});

test("stale or insufficient benchmark evidence is marked ignored and cannot mutate policy", async () => {
  const { createBenchmarkEvidenceV1, createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1, selectStrategy } =
    await loadM4();
  const policy = createStrategyPolicyV1();
  const before = JSON.stringify(policy);
  const selected = selectStrategy({
    declaredCapability: createDeclaredModelCapabilityV1(fixture("model-capabilities-v1-basic.json")),
    runtimeProfile: createRuntimeProfileSnapshotV1(fixture("runtime-profile-v1-local.json")),
    benchmarkEvidence: [
      createBenchmarkEvidenceV1({ evidenceId: "stale", strategyId: "flagship_full_context_v1", sampleSize: 50, stability: 0.99, confidence: 0.99, capturedAt: "2025-01-01T00:00:00.000Z", source: "old-summary" }),
      createBenchmarkEvidenceV1({ evidenceId: "tiny", strategyId: "local_sectional_repair_v1", sampleSize: 2, stability: 0.99, confidence: 0.99, capturedAt: "2026-07-11T00:00:00.000Z", source: "tiny-summary" }),
    ],
    policy,
    asOf: AS_OF,
  });

  assert.deepEqual(selected.provenance.evidence.map((entry) => [entry.evidenceId, entry.status, entry.reason]), [
    ["stale", "ignored", "stale"],
    ["tiny", "ignored", "insufficient_sample_size"],
  ]);
  assert.equal(JSON.stringify(policy), before);
  assert.equal(policy.policyVersion, "adaptive-workflow-strategy-policy-v1");
});

test("benchmark evidence only gates selection through explicit policy rules with missing runtime probes", async () => {
  const { createBenchmarkEvidenceV1, createDeclaredModelCapabilityV1, createStrategyPolicyV1, selectStrategy } = await loadM4();
  const declaredCapability = createDeclaredModelCapabilityV1(fixture("model-capabilities-v1-basic.json"));
  const policy = createStrategyPolicyV1({ strategies: [strategy("evidence_gated_v1", { benchmark: { required: true, minAverageScore: 75 } })], fallbackOrder: ["evidence_gated_v1"] });
  assert.throws(() => selectStrategy({ declaredCapability, policy, asOf: AS_OF }), /No eligible AdaptiveWorkflow strategy/);
  const selected = selectStrategy({ declaredCapability, policy, asOf: AS_OF, benchmarkEvidence: [createBenchmarkEvidenceV1({ evidenceId: "good", strategyId: "evidence_gated_v1", sampleSize: 20, stability: 0.9, confidence: 0.9, averageScore: 80, capturedAt: "2026-07-11T00:00:00.000Z", source: "summary" })] });
  assert.equal(selected.strategyId, "evidence_gated_v1");
  assert.equal(selected.provenance.runtimeProfileSource, "missing");
});

test("context budget uses positive provider model runtime and policy limits with reserves", async () => {
  const { calculateContextBudget, createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1 } = await loadM4();
  const declaredCapability = createDeclaredModelCapabilityV1({
    ...fixture("model-capabilities-v1-basic.json"),
    providerContextWindowTokens: 96000,
    contextWindowTokens: 64000,
    maxOutputTokens: 4096,
  });
  const runtimeProfile = createRuntimeProfileSnapshotV1({
    ...fixture("runtime-profile-v1-local.json"),
    capabilities: { ...fixture("runtime-profile-v1-local.json").capabilities, maxContextTokens: 48000 },
  });
  const policy = createStrategyPolicyV1({ context: { maxContextTokens: 40000, maxOutputTokens: 2048, toolReserveTokens: 512 } });
  const budget = calculateContextBudget({ declaredCapability, runtimeProfile, policy, requestedOutputTokens: 9000, toolReserveTokens: 256 });

  assert.equal(budget.contextWindowTokens, 40000);
  assert.equal(budget.outputReserveTokens, 2048);
  assert.equal(budget.toolReserveTokens, 512);
  assert.equal(budget.inputBudgetTokens, 37440);
  assert.deepEqual(budget.limitingSources, ["policy.context.maxContextTokens"]);
  assert.equal(budget.provenance.limits.length, 4);

  const constrained = calculateContextBudget({
    declaredCapability,
    runtimeProfile,
    policy: createStrategyPolicyV1({ context: { maxContextTokens: 100, maxOutputTokens: 80, toolReserveTokens: 40 } }),
    requestedOutputTokens: 1000,
  });
  assert.equal(constrained.inputBudgetTokens, 0);
});

test("malformed profile and policy shapes fail deterministically", async () => {
  const { createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1 } = await loadM4();
  assert.throws(() => createDeclaredModelCapabilityV1({ ...fixture("model-capabilities-v1-basic.json"), providerId: "" }), /DeclaredModelCapabilityV1/);
  assert.throws(() => createRuntimeProfileSnapshotV1({ ...fixture("runtime-profile-v1-local.json"), source: "live_probe" }), /RuntimeProfileSnapshotV1/);
  assert.throws(() => createStrategyPolicyV1({ fallbackOrder: [] }), /StrategyPolicyV1/);
  assert.throws(() => createStrategyPolicyV1({ strategies: [strategy("dup"), strategy("dup", { precedence: 2 })], fallbackOrder: ["dup", "dup"] }), /StrategyPolicyV1/);
  assert.throws(() => createStrategyPolicyV1({ thresholds: { minBenchmarkSampleSize: 0 } }), /StrategyPolicyV1/);
  assert.throws(() => createStrategyPolicyV1({ strategies: [strategy("bad_resource", { resourcePolicy: { maxConcurrency: 0, candidateCount: 1, routing: "x" } })], fallbackOrder: ["bad_resource"] }), /StrategyPolicyV1/);
});

test("selection refuses ineligible fallback and honors provider plus policy context limits", async () => {
  const { createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1, selectStrategy } = await loadM4();
  const declaredCapability = createDeclaredModelCapabilityV1({ ...fixture("model-capabilities-v1-basic.json"), providerContextWindowTokens: 2000 });
  const runtimeProfile = createRuntimeProfileSnapshotV1({ ...fixture("runtime-profile-v1-local.json"), capabilities: { maxContextTokens: 128000 } });
  const policy = createStrategyPolicyV1({ context: { maxContextTokens: 1000 }, strategies: [strategy("needs_too_much", { score: 10, minContextTokens: 1001 })], fallbackOrder: ["needs_too_much"] });
  assert.throws(() => selectStrategy({ declaredCapability, runtimeProfile, policy, asOf: AS_OF }), /No eligible AdaptiveWorkflow strategy/);
});

test("benchmark evidence marks invalid future and low quality timestamps without changing policy", async () => {
  const { createBenchmarkEvidenceV1, createDeclaredModelCapabilityV1, createRuntimeProfileSnapshotV1, createStrategyPolicyV1, selectStrategy } = await loadM4();
  const policy = createStrategyPolicyV1();
  const selected = selectStrategy({
    declaredCapability: createDeclaredModelCapabilityV1(fixture("model-capabilities-v1-basic.json")),
    runtimeProfile: createRuntimeProfileSnapshotV1(fixture("runtime-profile-v1-local.json")),
    policy,
    benchmarkEvidence: [
      { evidenceId: "invalid", strategyId: "flagship_full_context_v1", sampleSize: 50, stability: 1, confidence: 1, capturedAt: "not-a-date", source: "bad-summary" },
      createBenchmarkEvidenceV1({ evidenceId: "future", strategyId: "flagship_full_context_v1", sampleSize: 50, stability: 1, confidence: 1, capturedAt: "2026-08-01T00:00:00.000Z", source: "future-summary" }),
      createBenchmarkEvidenceV1({ evidenceId: "low", strategyId: "flagship_full_context_v1", sampleSize: 50, stability: 0.9, confidence: 0.5, capturedAt: "2026-07-11T00:00:00.000Z", source: "low-summary" }),
    ],
    asOf: AS_OF,
  });
  assert.deepEqual(selected.provenance.evidence.map((entry) => [entry.evidenceId, entry.status, entry.reason]), [
    ["invalid", "ignored", "invalid_timestamp"],
    ["future", "ignored", "future_timestamp"],
    ["low", "ignored", "low_confidence"],
  ]);
  assert.equal(JSON.parse(JSON.stringify(selected)).provenance.evidence[0].ageMs, null); assert.equal(policy.policyVersion, "adaptive-workflow-strategy-policy-v1");
});

test("runtime policy modules avoid direct IO, environment, provider probing, and clocks", () => {
  for (const file of ["profiles.js", "strategy-policy.js", "context-budget.js"]) {
    const source = readFileSync(join(__dirname, "../../packages/runtime/src/adaptive-workflow", file), "utf8");
    assert.doesNotMatch(source, /\b(Date\.now|process\.|fetch\(|XMLHttpRequest|readFile|writeFile|hardware|probeHardware)\b/);
  }
});

// ## TODO: Test Permutations
// - equal strategy scores should use deterministic tie-breaking
// - missing runtime probes should use declared capability fallback
// - stale benchmark evidence should not influence selection
// - constrained context windows should preserve non-negative input budget
