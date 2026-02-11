const CAPTURED_INPUT_SCHEMA = "agent-kernel/CapturedInputArtifact";
const TELEMETRY_RECORD_SCHEMA = "agent-kernel/TelemetryRecord";
const LLM_ADAPTERS = new Set(["llm", "ollama"]);

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function asIso(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function asFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function captureSortKey(turn) {
  const createdAtMs = turn?.createdAt ? Date.parse(turn.createdAt) : NaN;
  if (Number.isFinite(createdAtMs)) return createdAtMs;
  return Number.MAX_SAFE_INTEGER;
}

export function isLlmCaptureArtifact(artifact) {
  if (!isObject(artifact)) return false;
  if (artifact.schema !== CAPTURED_INPUT_SCHEMA) return false;
  const adapter = String(artifact?.source?.adapter || "").trim().toLowerCase();
  return LLM_ADAPTERS.has(adapter);
}

export function buildLlmTraceTurns(captures = []) {
  const list = Array.isArray(captures) ? captures : [];
  const turns = list
    .filter((artifact) => isLlmCaptureArtifact(artifact))
    .map((artifact, index) => {
      const payload = isObject(artifact.payload) ? artifact.payload : {};
      const source = isObject(artifact.source) ? artifact.source : {};
      const request = isObject(source.request) ? source.request : {};
      const phaseTiming = isObject(payload.phaseTiming) ? payload.phaseTiming : {};
      const durationMs = asFiniteNumber(phaseTiming.durationMs);
      const parseErrors = Array.isArray(payload.errors) ? payload.errors : [];
      const id = artifact?.meta?.id || `llm_capture_${index + 1}`;
      return {
        id,
        runId: artifact?.meta?.runId || "run_unknown",
        createdAt: asIso(artifact?.meta?.createdAt),
        adapter: source.adapter || "llm",
        requestId: source.requestId,
        phase: payload.phase || null,
        phaseContext: payload.phaseContext || null,
        durationMs,
        model: request.model || null,
        baseUrl: request.baseUrl || null,
        request,
        prompt: payload.prompt || request.prompt || "",
        responseRaw: payload.responseRaw || "",
        responseParsed: payload.responseParsed,
        summary: payload.summary,
        errors: parseErrors,
        errorCount: parseErrors.length,
        status: parseErrors.length > 0 ? "error" : "ok",
        artifact,
      };
    });

  turns.sort((left, right) => {
    const leftKey = captureSortKey(left);
    const rightKey = captureSortKey(right);
    if (leftKey !== rightKey) return leftKey - rightKey;
    return String(left.id).localeCompare(String(right.id));
  });
  return turns;
}

export function summarizeLlmTrace(captures = []) {
  const turns = buildLlmTraceTurns(captures);
  const phaseCounts = {};
  const models = new Set();
  const baseUrls = new Set();
  const durations = [];
  let errorTurns = 0;
  let errorCount = 0;

  turns.forEach((turn) => {
    if (turn.phase) {
      phaseCounts[turn.phase] = (phaseCounts[turn.phase] || 0) + 1;
    }
    if (turn.model) models.add(turn.model);
    if (turn.baseUrl) baseUrls.add(turn.baseUrl);
    if (Number.isFinite(turn.durationMs)) durations.push(turn.durationMs);
    if (turn.errorCount > 0) {
      errorTurns += 1;
      errorCount += turn.errorCount;
    }
  });

  const totalDurationMs = durations.reduce((sum, value) => sum + value, 0);
  const samples = durations.length;
  const summary = {
    turnCount: turns.length,
    errorTurns,
    errorCount,
    phases: phaseCounts,
    models: Array.from(models).sort(),
    baseUrls: Array.from(baseUrls).sort(),
    durationMs: {
      total: totalDurationMs,
      avg: samples > 0 ? totalDurationMs / samples : 0,
      min: samples > 0 ? Math.min(...durations) : null,
      max: samples > 0 ? Math.max(...durations) : null,
      samples,
    },
    firstTurnAt: turns[0]?.createdAt || null,
    lastTurnAt: turns.length > 0 ? turns[turns.length - 1].createdAt : null,
  };

  return summary;
}

export function buildLlmTraceTelemetryRecord({
  captures = [],
  runId,
  createdAt,
  clock = () => new Date().toISOString(),
  producedBy = "annotator",
} = {}) {
  const turns = buildLlmTraceTurns(captures);
  const summary = summarizeLlmTrace(captures);
  const resolvedRunId = runId || turns[0]?.runId || "run_unknown";
  const timestamp = createdAt || clock();
  return {
    schema: TELEMETRY_RECORD_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: `telemetry_llm_trace_${resolvedRunId}`,
      runId: resolvedRunId,
      createdAt: timestamp,
      producedBy,
    },
    scope: "run",
    data: {
      kind: "llm_trace",
      summary,
      turns: turns.map((turn) => ({
        id: turn.id,
        createdAt: turn.createdAt,
        phase: turn.phase,
        phaseContext: turn.phaseContext,
        status: turn.status,
        errorCount: turn.errorCount,
        durationMs: turn.durationMs,
        model: turn.model,
        baseUrl: turn.baseUrl,
      })),
    },
  };
}
