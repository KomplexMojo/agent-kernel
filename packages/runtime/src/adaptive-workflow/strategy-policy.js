export const FLAGSHIP_FULL_CONTEXT_STRATEGY_ID = "flagship_full_context_v1";
export const LOCAL_SECTIONAL_REPAIR_STRATEGY_ID = "local_sectional_repair_v1";
export const STRATEGY_POLICY_SCHEMA = "agent-kernel/AdaptiveWorkflowStrategyPolicy";
export const SELECTED_STRATEGY_SCHEMA = "agent-kernel/SelectedStrategy";
export const STRATEGY_POLICY_VERSION = "adaptive-workflow-strategy-policy-v1";
const TIE_BREAKERS = Object.freeze(["score_desc", "precedence_asc", "fallback_order", "strategy_id"]);
const DEFAULT_THRESHOLDS = Object.freeze({ minBenchmarkSampleSize: 10, minBenchmarkStability: 0.8, minBenchmarkConfidence: 0.75, maxBenchmarkAgeMs: 2592000000 });
const DEFAULT_CONTEXT = Object.freeze({ maxContextTokens: 128000, maxOutputTokens: 4096, toolReserveTokens: 256 });
const DEFAULT_STRATEGIES = Object.freeze([
  Object.freeze({ id: FLAGSHIP_FULL_CONTEXT_STRATEGY_ID, precedence: 10, score: 100, minContextTokens: 64000, requires: Object.freeze({ textGeneration: true, structuredOutput: true }), resourcePolicy: Object.freeze({ maxConcurrency: 1, candidateCount: 1, routing: "flagship" }) }),
  Object.freeze({ id: LOCAL_SECTIONAL_REPAIR_STRATEGY_ID, precedence: 20, score: 60, minContextTokens: 8000, requires: Object.freeze({ textGeneration: true }), resourcePolicy: Object.freeze({ maxConcurrency: 1, candidateCount: 2, routing: "local_sectional_repair" }) }),
]);

export function createStrategyPolicyV1(input = {}) {
  const strategies = (input.strategies || DEFAULT_STRATEGIES).map(normalizeStrategy);
  const fallbackOrder = input.fallbackOrder || strategies.map((strategy) => strategy.id);
  const policy = freeze({
    schema: STRATEGY_POLICY_SCHEMA,
    schemaVersion: 1,
    policyVersion: input.policyVersion || STRATEGY_POLICY_VERSION,
    strategies,
    fallbackOrder: [...fallbackOrder],
    thresholds: { ...DEFAULT_THRESHOLDS, ...(input.thresholds || {}) },
    context: { ...DEFAULT_CONTEXT, ...(input.context || {}) },
    provenance: { source: input.source || "runtime-default", policyVersion: input.policyVersion || STRATEGY_POLICY_VERSION },
    tieBreakers: [...TIE_BREAKERS],
  });
  if (!isStrategyPolicyV1(policy)) throw new Error("Invalid StrategyPolicyV1.");
  return policy;
}

export function selectStrategy({ declaredCapability, runtimeProfile, benchmarkEvidence = [], policy = createStrategyPolicyV1(), asOf } = {}) {
  if (!obj(declaredCapability)) throw new Error("declaredCapability is required");
  if (!isStrategyPolicyV1(policy)) throw new Error("Invalid StrategyPolicyV1.");
  const fallbackRank = new Map(policy.fallbackOrder.map((id, index) => [id, index]));
  const contextTokens = effectiveContextTokens(declaredCapability, runtimeProfile, policy);
  const evidence = benchmarkEvidence.map((item) => evaluateEvidence(item, policy, asOf));
  const evidenceByStrategy = new Map();
  evidence.filter((item) => item.status === "accepted").forEach((item) => {
    const bucket = evidenceByStrategy.get(item.strategyId) || [];
    bucket.push(item); evidenceByStrategy.set(item.strategyId, bucket);
  });
  const candidates = policy.strategies.map((strategy) => evaluateStrategy(strategy, declaredCapability, contextTokens, fallbackRank, evidenceByStrategy));
  const eligible = candidates.filter((candidate) => candidate.eligible).sort(compareCandidates);
  if (eligible.length === 0) throw new Error("No eligible AdaptiveWorkflow strategy.");
  const selected = eligible[0];
  return freeze({
    schema: SELECTED_STRATEGY_SCHEMA,
    schemaVersion: 1,
    strategyId: selected.strategyId,
    policyVersion: policy.policyVersion,
    selectedAt: asOf || null,
    selectedStrategyRef: { id: `${policy.policyVersion}:${selected.strategyId}`, schema: SELECTED_STRATEGY_SCHEMA, schemaVersion: 1 },
    resourcePolicy: selected.resourcePolicy,
    candidates,
    provenance: {
      policyVersion: policy.policyVersion,
      declaredCapabilitySource: declaredCapability.source || "declared",
      runtimeProfileSource: runtimeProfile?.source || "missing",
      contextTokens,
      evidence,
      tieBreakers: [...TIE_BREAKERS],
      reasons: [selected.fallbackRank === 0 ? "primary_eligible" : "fallback_order"],
    },
  });
}

export function classifyBenchmarkEvidence(evidence, policy = createStrategyPolicyV1(), asOf) {
  if (!isStrategyPolicyV1(policy)) throw new Error("Invalid StrategyPolicyV1.");
  return evaluateEvidence(evidence, policy, asOf);
}

function normalizeStrategy(strategy) {
  const out = { id: strategy.id, precedence: strategy.precedence, score: strategy.score, minContextTokens: strategy.minContextTokens, requires: { ...(strategy.requires || {}) }, resourcePolicy: { ...(strategy.resourcePolicy || {}) }, ...(strategy.benchmark ? { benchmark: { ...strategy.benchmark } } : {}) };
  if (!text(out.id) || !pos(out.precedence) || !Number.isFinite(out.score) || !pos(out.minContextTokens)) throw new Error("Invalid StrategyPolicyV1.");
  return out;
}
function evaluateStrategy(strategy, capability, contextTokens, fallbackRank, evidenceByStrategy) {
  const reasons = [];
  if (strategy.requires.textGeneration && capability.supports?.textGeneration === false) reasons.push("missing_text_generation");
  if (strategy.requires.structuredOutput && capability.supports?.structuredOutput !== true) reasons.push("missing_structured_output");
  if (contextTokens < strategy.minContextTokens) reasons.push("constrained_context");
  const evidence = evidenceByStrategy.get(strategy.id) || [];
  if (strategy.benchmark?.required && evidence.length === 0) reasons.push("missing_benchmark_evidence");
  if (Number.isFinite(strategy.benchmark?.minAverageScore) && Math.max(...evidence.map((item) => item.averageScore ?? Number.NEGATIVE_INFINITY)) < strategy.benchmark.minAverageScore) reasons.push("benchmark_below_threshold");
  return freeze({ strategyId: strategy.id, eligible: reasons.length === 0, score: strategy.score, precedence: strategy.precedence, fallbackRank: fallbackRank.has(strategy.id) ? fallbackRank.get(strategy.id) : Number.MAX_SAFE_INTEGER, reasons, resourcePolicy: strategy.resourcePolicy });
}
function evaluateEvidence(evidence, policy, asOf) {
  const t = policy.thresholds;
  let status = "accepted"; let reason = "accepted";
  const captured = Date.parse(evidence?.capturedAt); const now = Date.parse(asOf);
  if (!evidence || !text(evidence.evidenceId) || !text(evidence.strategyId) || !text(evidence.source) || !policy.fallbackOrder.includes(evidence.strategyId) || !pos(evidence.sampleSize) || !unit(evidence.stability) || !unit(evidence.confidence) || (evidence.averageScore !== undefined && !Number.isFinite(evidence.averageScore))) [status, reason] = ["ignored", "invalid_evidence"];
  else if (!Number.isFinite(captured) || !Number.isFinite(now)) [status, reason] = ["ignored", "invalid_timestamp"];
  else if (captured > now) [status, reason] = ["ignored", "future_timestamp"];
  else if (evidence.sampleSize < t.minBenchmarkSampleSize) [status, reason] = ["ignored", "insufficient_sample_size"];
  else if (evidence.stability < t.minBenchmarkStability) [status, reason] = ["ignored", "unstable"];
  else if (evidence.confidence < t.minBenchmarkConfidence) [status, reason] = ["ignored", "low_confidence"];
  else if (now - captured > t.maxBenchmarkAgeMs) [status, reason] = ["ignored", "stale"];
  return freeze({ evidenceId: evidence?.evidenceId || "unknown", strategyId: evidence?.strategyId || "unknown", status, reason, sampleSize: evidence?.sampleSize ?? null, stability: evidence?.stability ?? null, confidence: evidence?.confidence ?? null, averageScore: evidence?.averageScore ?? null, capturedAt: evidence?.capturedAt ?? null, ageMs: Number.isFinite(captured) && Number.isFinite(now) ? Math.max(0, now - captured) : null, source: evidence?.source || "unknown" });
}
function effectiveContextTokens(capability, runtimeProfile, policy) {
  const limits = [capability.providerContextWindowTokens, capability.contextWindowTokens, runtimeProfile?.capabilities?.maxContextTokens, policy.context?.maxContextTokens].filter(pos);
  return limits.length ? Math.min(...limits) : 0;
}
function compareCandidates(a, b) { return b.score - a.score || a.precedence - b.precedence || a.fallbackRank - b.fallbackRank || a.strategyId.localeCompare(b.strategyId); }
function isStrategyPolicyV1(v) {
  if (!obj(v) || v.schema !== STRATEGY_POLICY_SCHEMA || v.schemaVersion !== 1 || !text(v.policyVersion) || !Array.isArray(v.strategies) || v.strategies.length === 0 || !Array.isArray(v.fallbackOrder) || v.fallbackOrder.length !== v.strategies.length || !obj(v.thresholds) || !obj(v.context)) return false;
  const ids = new Set(v.strategies.map((s) => s.id));
  return ids.size === v.strategies.length && new Set(v.fallbackOrder).size === v.fallbackOrder.length && v.fallbackOrder.every((id) => ids.has(id))
    && v.strategies.every(validStrategy) && pos(v.thresholds.minBenchmarkSampleSize) && unit(v.thresholds.minBenchmarkStability) && unit(v.thresholds.minBenchmarkConfidence) && pos(v.thresholds.maxBenchmarkAgeMs)
    && pos(v.context.maxContextTokens) && pos(v.context.maxOutputTokens) && nonneg(v.context.toolReserveTokens);
}
function validStrategy(s) { return obj(s) && text(s.id) && pos(s.precedence) && Number.isFinite(s.score) && pos(s.minContextTokens) && obj(s.requires) && bools(s.requires, ["textGeneration", "structuredOutput", "streaming"], true) && obj(s.resourcePolicy) && pos(s.resourcePolicy.maxConcurrency) && pos(s.resourcePolicy.candidateCount) && text(s.resourcePolicy.routing) && (s.benchmark === undefined || (obj(s.benchmark) && (s.benchmark.required === undefined || typeof s.benchmark.required === "boolean") && (s.benchmark.minAverageScore === undefined || Number.isFinite(s.benchmark.minAverageScore)))); }
function bools(v, keys, optional = false) { return keys.every((key) => v[key] === undefined ? optional : typeof v[key] === "boolean"); }
function obj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function text(v) { return typeof v === "string" && v.trim().length > 0; }
function pos(v) { return Number.isInteger(v) && v > 0; }
function nonneg(v) { return Number.isInteger(v) && v >= 0; }
function unit(v) { return Number.isFinite(v) && v >= 0 && v <= 1; }
function freeze(v) {
  if (obj(v) || Array.isArray(v)) { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
