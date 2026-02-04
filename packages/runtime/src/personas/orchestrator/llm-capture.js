const CAPTURED_INPUT_SCHEMA = "agent-kernel/CapturedInputArtifact";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function buildMeta(
  meta = {},
  { producedBy = "orchestrator", runId = "run_orchestrator", clock = () => new Date().toISOString(), idPrefix = "capture_llm" } = {},
) {
  if (meta.id && meta.runId && meta.createdAt && meta.producedBy) {
    return meta;
  }
  const createdAt = meta.createdAt || clock();
  const resolvedRunId = meta.runId || runId;
  const id = meta.id || `${idPrefix}_${resolvedRunId}`;
  return {
    id,
    runId: resolvedRunId,
    createdAt,
    producedBy: meta.producedBy || producedBy,
    correlationId: meta.correlationId,
    note: meta.note,
  };
}

export function buildLlmCaptureArtifact({
  prompt,
  responseText,
  responseParsed,
  summary,
  parseErrors,
  model,
  baseUrl,
  options,
  stream,
  requestId,
  meta,
  runId,
  producedBy,
  phase,
  phaseContext,
  phaseTiming,
  remainingBudgetTokens,
  clock = () => new Date().toISOString(),
} = {}) {
  const errors = [];
  if (!isNonEmptyString(prompt)) errors.push("LLM capture requires prompt.");
  if (!isNonEmptyString(responseText)) errors.push("LLM capture requires responseText.");
  if (!isNonEmptyString(model)) errors.push("LLM capture requires model.");
  if (errors.length > 0) {
    return { capture: null, errors };
  }

  const request = { model, prompt };
  if (isNonEmptyString(baseUrl)) request.baseUrl = baseUrl;
  if (options && typeof options === "object") request.options = options;
  if (stream !== undefined) request.stream = Boolean(stream);

  const payload = { prompt, responseRaw: responseText };
  if (responseParsed !== undefined) payload.responseParsed = responseParsed;
  if (summary !== undefined) payload.summary = summary;
  if (Array.isArray(parseErrors) && parseErrors.length > 0) payload.errors = parseErrors;
  if (isNonEmptyString(phase)) payload.phase = phase;
  if (isNonEmptyString(phaseContext)) payload.phaseContext = phaseContext;
  if (phaseTiming && typeof phaseTiming === "object") {
    const timing = {};
    if (isNonEmptyString(phaseTiming.startedAt)) timing.startedAt = phaseTiming.startedAt;
    if (isNonEmptyString(phaseTiming.endedAt)) timing.endedAt = phaseTiming.endedAt;
    if (Number.isFinite(phaseTiming.durationMs)) timing.durationMs = phaseTiming.durationMs;
    if (Object.keys(timing).length > 0) payload.phaseTiming = timing;
  }
  if (Number.isInteger(remainingBudgetTokens)) payload.remainingBudgetTokens = remainingBudgetTokens;

  const capture = {
    schema: CAPTURED_INPUT_SCHEMA,
    schemaVersion: 1,
    meta: buildMeta(meta, { producedBy, runId, clock }),
    source: {
      adapter: "llm",
      requestId: isNonEmptyString(requestId) ? requestId : undefined,
      request,
    },
    contentType: "application/json",
    payload,
  };

  return { capture, errors: undefined };
}
