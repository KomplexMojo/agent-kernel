import { createModelCapabilityProfileV1 } from "./model-adapter.js";

export const BENCHMARK_EVIDENCE_SCHEMA = "agent-kernel/BenchmarkEvidence";
export const RUNTIME_PROFILE_SNAPSHOT_SCHEMA = "agent-kernel/AdaptiveWorkflowRuntimeProfile";
export const MODEL_CAPABILITY_SCHEMA_VERSION = 1;

export function createDeclaredModelCapabilityV1(input = {}) {
  const base = createModelCapabilityProfileV1({ ...input, source: "declared" });
  const out = freeze({ ...base, ...(pos(input.providerContextWindowTokens) ? { providerContextWindowTokens: input.providerContextWindowTokens } : {}) });
  if (!isDeclaredModelCapabilityV1(out)) throw new Error("Invalid DeclaredModelCapabilityV1.");
  return out;
}

export function isDeclaredModelCapabilityV1(v) {
  return obj(v) && v.schemaVersion === 1 && text(v.providerId) && (v.modelId === null || text(v.modelId))
    && v.source === "declared" && (v.contextWindowTokens === null || pos(v.contextWindowTokens))
    && (v.maxOutputTokens === null || pos(v.maxOutputTokens)) && (v.providerContextWindowTokens === undefined || pos(v.providerContextWindowTokens))
    && obj(v.supports) && ["textGeneration", "structuredOutput", "streaming"].every((key) => typeof v.supports[key] === "boolean");
}

export function createRuntimeProfileSnapshotV1(input = {}) {
  const caps = input.capabilities || {};
  const out = freeze({
    schema: RUNTIME_PROFILE_SNAPSHOT_SCHEMA,
    schemaVersion: 1,
    meta: input.meta,
    profileVersion: input.profileVersion,
    capturedAt: input.capturedAt,
    source: input.source,
    capabilities: {
      providerIds: Array.isArray(caps.providerIds) ? [...caps.providerIds] : undefined,
      maxContextTokens: caps.maxContextTokens,
      maxConcurrency: caps.maxConcurrency,
      supportsReplay: caps.supportsReplay,
      supportsCancellation: caps.supportsCancellation,
    },
    ...(input.refs ? { refs: input.refs } : {}),
  });
  if (!isRuntimeProfileSnapshotV1(out)) throw new Error("Invalid RuntimeProfileSnapshotV1.");
  return out;
}

export function isRuntimeProfileSnapshotV1(v) {
  const caps = v?.capabilities;
  return obj(v) && v.schema === RUNTIME_PROFILE_SNAPSHOT_SCHEMA && v.schemaVersion === 1 && meta(v.meta)
    && text(v.profileVersion) && text(v.capturedAt) && ["declared", "probed", "fixture"].includes(v.source) && obj(caps)
    && (caps.providerIds === undefined || (Array.isArray(caps.providerIds) && caps.providerIds.every(text)))
    && optPos(caps.maxContextTokens) && optPos(caps.maxConcurrency) && optBool(caps.supportsReplay) && optBool(caps.supportsCancellation);
}

export function createBenchmarkEvidenceV1(input = {}) {
  const out = freeze({
    schema: BENCHMARK_EVIDENCE_SCHEMA,
    schemaVersion: 1,
    evidenceId: input.evidenceId,
    strategyId: input.strategyId,
    sampleSize: input.sampleSize,
    stability: input.stability,
    confidence: input.confidence,
    capturedAt: input.capturedAt,
    source: input.source,
    ...(input.averageScore === undefined ? {} : { averageScore: input.averageScore }),
    ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
  });
  if (!isBenchmarkEvidenceV1(out)) throw new Error("Invalid BenchmarkEvidenceV1.");
  return out;
}

export function isBenchmarkEvidenceV1(v) {
  return obj(v) && v.schema === BENCHMARK_EVIDENCE_SCHEMA && v.schemaVersion === 1 && text(v.evidenceId)
    && text(v.strategyId) && pos(v.sampleSize) && unit(v.stability) && unit(v.confidence) && text(v.capturedAt)
    && text(v.source) && (v.averageScore === undefined || Number.isFinite(v.averageScore));
}

function meta(v) { return obj(v) && ["id", "runId", "createdAt", "producedBy"].every((key) => text(v[key])); }
function obj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function text(v) { return typeof v === "string" && v.trim().length > 0; }
function pos(v) { return Number.isInteger(v) && v > 0; }
function optPos(v) { return v === undefined || pos(v); }
function optBool(v) { return v === undefined || typeof v === "boolean"; }
function unit(v) { return Number.isFinite(v) && v >= 0 && v <= 1; }
function freeze(v) {
  if (obj(v) || Array.isArray(v)) { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
