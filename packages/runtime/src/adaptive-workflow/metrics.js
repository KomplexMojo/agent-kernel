export const ADAPTIVE_WORKFLOW_METRICS_SCHEMA = "agent-kernel/AdaptiveWorkflowMetrics";

// Whole-key match only, so observability fields like `tokenUsage`, `tokenHint`,
// and `promptTokens` are never mistaken for credentials.
const SECRET_KEY = /^(authorization|bearer|api[-_]?key|api[-_]?token|access[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|secret|password|passphrase|token)$/i;
const MAX_SCAN_DEPTH = 8;

export function summarizeAdaptiveWorkflowMetrics({
  state,
  captures = [],
  selectedStrategy,
  runtimeProfile,
  benchmarkClassifications,
  model,
  provider,
  clock = () => new Date().toISOString(),
} = {}) {
  const events = Array.isArray(state?.events) ? state.events : [];
  const captureList = Array.isArray(captures) ? captures : [];

  // Audit scan: count secret-shaped inputs. Nothing scanned here is copied into
  // the output, which only emits hashes, enums, counts, and numbers.
  const redaction = { count: 0 };
  scanSecrets(events, redaction, 0);
  scanSecrets(captureList, redaction, 0);

  const runId = text(state?.runId) ? state.runId : "adaptive_workflow_run";
  const outcome = text(state?.phase) ? state.phase : "unknown";

  const phaseTransitions = events
    .filter((event) => text(event?.phase))
    .map((event) => ({ phase: event.phase, kind: text(event.kind) ? event.kind : "phase_transition", at: event.occurredAt ?? null }));

  const promptHashes = [];
  const responseHashes = [];
  let latencyTotal = 0;
  let latencySamples = 0;
  let latencyMax = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let tokenSamples = 0;
  for (const capture of captureList) {
    const payload = capture?.payload || {};
    if (text(payload.prompt)) promptHashes.push(fingerprint(payload.prompt));
    if (text(payload.responseRaw)) responseHashes.push(fingerprint(payload.responseRaw));
    const durationMs = payload.phaseTiming?.durationMs;
    if (Number.isFinite(durationMs)) {
      latencyTotal += durationMs;
      latencySamples += 1;
      latencyMax = Math.max(latencyMax, durationMs);
    }
    const usage = payload.usage;
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      const prompt = intOrNull(usage.promptTokens);
      const completion = intOrNull(usage.completionTokens);
      const total = intOrNull(usage.totalTokens);
      if (prompt !== null || completion !== null || total !== null) {
        promptTokens += prompt || 0;
        completionTokens += completion || 0;
        totalTokens += total !== null ? total : (prompt || 0) + (completion || 0);
        tokenSamples += 1;
      }
    }
  }

  // Response content refs are already SHA-256 content addresses computed by the
  // durable-store adapter; surface them without recomputing any hash here.
  const responseRefs = events.map((event) => event?.responseRef?.id).filter(text);

  const validations = summarizeValidations(events);
  const repairActions = events.filter((event) => event?.kind === "repair").map((event) => event?.details?.repairAction).filter(text);
  const sideEffectEvents = events.filter((event) => event?.kind === "side_effect");
  const duplicateSideEffects = sideEffectEvents.filter((event) => event?.details?.duplicate === true).length;

  const metrics = {
    schema: ADAPTIVE_WORKFLOW_METRICS_SCHEMA,
    schemaVersion: 1,
    meta: { id: `${runId}:metrics`, runId, createdAt: clock(), producedBy: "adaptive-workflow" },
    runId,
    outcome,
    model: text(model) ? model : inferModel(captureList),
    provider: text(provider) ? provider : null,
    selectedStrategy: selectedStrategy
      ? { strategyId: selectedStrategy.strategyId ?? null, policyVersion: selectedStrategy.policyVersion ?? null }
      : null,
    runtimeProfile: runtimeProfile
      ? { source: runtimeProfile.source ?? null, profileVersion: runtimeProfile.profileVersion ?? null }
      : null,
    phaseTransitions,
    prompts: { count: promptHashes.length, hashes: promptHashes },
    responses: { count: responseHashes.length, hashes: responseHashes, refs: responseRefs },
    validations,
    repairs: { count: repairActions.length, actions: repairActions },
    sideEffects: { count: sideEffectEvents.length, duplicates: duplicateSideEffects },
    latency: { totalMs: latencyTotal, samples: latencySamples, maxMs: latencyMax },
    tokenUsage: tokenSamples > 0 ? { promptTokens, completionTokens, totalTokens, samples: tokenSamples } : null,
    benchmark: summarizeBenchmark(benchmarkClassifications),
    redactions: redaction.count,
  };
  return deepFreeze(metrics);
}

function summarizeValidations(events) {
  let passed = 0;
  let failed = 0;
  let previous = "intake";
  for (const event of events) {
    const target = event?.phase;
    if ((previous === "validate" && target === "execute") || (previous === "verify" && target === "complete")) {
      passed += 1;
    } else if ((previous === "validate" || previous === "verify") && target === "repair") {
      failed += 1;
    }
    if (text(target)) previous = target;
  }
  return { total: passed + failed, passed, failed };
}

function summarizeBenchmark(classifications) {
  if (!Array.isArray(classifications) || classifications.length === 0) return null;
  let accepted = 0;
  let ignored = 0;
  for (const entry of classifications) {
    if (entry?.status === "accepted") accepted += 1;
    else ignored += 1;
  }
  return { accepted, ignored, total: classifications.length };
}

function inferModel(captures) {
  for (const capture of captures) {
    const candidate = capture?.source?.request?.model ?? capture?.payload?.model;
    if (text(candidate)) return candidate;
  }
  return null;
}

function scanSecrets(value, redaction, depth) {
  if (value === null || typeof value !== "object" || depth > MAX_SCAN_DEPTH) return;
  if (Array.isArray(value)) {
    for (const entry of value) scanSecrets(entry, redaction, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && isNonEmptyPrimitive(entry)) {
      redaction.count += 1;
      continue;
    }
    scanSecrets(entry, redaction, depth + 1);
  }
}

function isNonEmptyPrimitive(value) {
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "number" || typeof value === "boolean";
}

// FNV-1a 32-bit fingerprint (deterministic, non-cryptographic) so prompts and
// responses are recorded as stable hashes instead of raw text.
function fingerprint(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function intOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
