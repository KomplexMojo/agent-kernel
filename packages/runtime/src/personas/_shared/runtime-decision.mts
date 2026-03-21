import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DOMAIN_CONSTRAINTS,
} from "../../contracts/domain-constants.js";

const ACTION_SCHEMA = "agent-kernel/Action";

export const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";
export const RUNTIME_DECISION_LLM_LIVE_MODE = Object.freeze({
  deferredOnly: "deferred_only",
  manualNondeterministic: "manual_nondeterministic",
});

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecisionKind(value, fallback = "next_move") {
  return asNonEmptyString(value) || fallback;
}

function asTick(value, fallback = 0) {
  if (Number.isInteger(value)) return value;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneAction(action, { actorId, tick } = {}) {
  if (!isObject(action)) return null;
  const cloned = { ...action };
  if (!cloned.schema) cloned.schema = ACTION_SCHEMA;
  if (!Number.isInteger(cloned.schemaVersion)) cloned.schemaVersion = 1;
  if (!asNonEmptyString(cloned.actorId) && asNonEmptyString(actorId)) {
    cloned.actorId = actorId;
  }
  if (!Number.isInteger(cloned.tick)) {
    cloned.tick = asTick(tick, 0);
  }
  return cloned;
}

function normalizeCandidateAction(candidate, index, { actorId, tick } = {}) {
  if (isObject(candidate) && isObject(candidate.action)) {
    const id = asNonEmptyString(candidate.id) || asNonEmptyString(candidate.action.id) || `candidate_${index + 1}`;
    const action = cloneAction(candidate.action, { actorId, tick });
    if (!action || !asNonEmptyString(action.kind)) return null;
    return { ...candidate, id, action };
  }
  if (isObject(candidate) && asNonEmptyString(candidate.kind)) {
    const action = cloneAction(candidate, { actorId, tick });
    if (!action) return null;
    return { id: asNonEmptyString(candidate.id) || `candidate_${index + 1}`, action };
  }
  return null;
}

function normalizeCandidateActions(candidateActions, { actorId, tick } = {}) {
  const list = Array.isArray(candidateActions) ? candidateActions : [];
  return list
    .map((candidate, index) => normalizeCandidateAction(candidate, index, { actorId, tick }))
    .filter(Boolean);
}

function normalizeProviderMode(value) {
  const normalized = asNonEmptyString(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "solver" || lowered === "llm" || lowered === "auto") {
    return lowered;
  }
  return null;
}

function normalizeLiveLlmMode(value) {
  const normalized = asNonEmptyString(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === RUNTIME_DECISION_LLM_LIVE_MODE.manualNondeterministic) {
    return RUNTIME_DECISION_LLM_LIVE_MODE.manualNondeterministic;
  }
  if (lowered === RUNTIME_DECISION_LLM_LIVE_MODE.deferredOnly) {
    return RUNTIME_DECISION_LLM_LIVE_MODE.deferredOnly;
  }
  return null;
}

function normalizeDecisionDiagnostics(entries, key) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .filter((entry) => isObject(entry) && asNonEmptyString(entry[key]))
    .map((entry) => ({ ...entry, [key]: entry[key].trim() }));
}

function normalizeJsonPromptOptions(value) {
  if (!isObject(value)) return undefined;
  return cloneJson(value);
}

function extractDecisionPayload(raw, { defaultDecisionKind = "next_move" } = {}) {
  if (!isObject(raw)) return null;
  if (isObject(raw.decision)) {
    return {
      contract: raw.decision.contract || RUNTIME_DECISION_CONTRACT,
      decisionKind: asDecisionKind(raw.decision.decisionKind, defaultDecisionKind),
      ...raw.decision,
    };
  }
  if (raw.contract === RUNTIME_DECISION_CONTRACT || asNonEmptyString(raw.selectedActionId)) {
    return {
      contract: raw.contract || RUNTIME_DECISION_CONTRACT,
      decisionKind: asDecisionKind(raw.decisionKind, defaultDecisionKind),
      ...raw,
    };
  }
  return null;
}

export function buildRuntimeDecisionEnvelope({
  decisionKind = "next_move",
  phase = "execute",
  tick = 0,
  actor = null,
  visibleActors = [],
  hazards = [],
  candidateActions = [],
  objectives = undefined,
  constraints = undefined,
  providerPolicy = undefined,
} = {}) {
  const actorRecord = isObject(actor) ? { ...actor } : {};
  const actorId = asNonEmptyString(actorRecord.id) || null;
  const resolvedTick = asTick(tick, 0);
  const normalizedCandidates = normalizeCandidateActions(candidateActions, { actorId, tick: resolvedTick });
  const normalizedPolicy = resolveRuntimeDecisionProviderPolicy(providerPolicy);
  const envelope = {
    contract: RUNTIME_DECISION_CONTRACT,
    decisionKind: asDecisionKind(decisionKind),
    phase: asNonEmptyString(phase) || "execute",
    tick: resolvedTick,
    actor: actorRecord,
    candidateActions: normalizedCandidates,
    providerPolicy: normalizedPolicy,
  };
  if (Array.isArray(visibleActors) && visibleActors.length > 0) {
    envelope.visibleActors = visibleActors.filter(isObject).map((entry) => ({ ...entry }));
  }
  if (Array.isArray(hazards) && hazards.length > 0) {
    envelope.hazards = hazards.filter(isObject).map((entry) => ({ ...entry }));
  }
  if (isObject(objectives)) {
    envelope.objectives = { ...objectives };
  }
  if (isObject(constraints)) {
    envelope.constraints = { ...constraints };
  }
  return envelope;
}

export function resolveRuntimeDecisionProviderPolicy(providerPolicy = undefined) {
  const policy = isObject(providerPolicy) ? providerPolicy : {};
  const mode = normalizeProviderMode(policy.mode) || "auto";
  const preferred = normalizeProviderMode(policy.preferred) || (mode === "llm" ? "llm" : "solver");
  const liveLlmMode = normalizeLiveLlmMode(policy.liveLlmMode)
    || RUNTIME_DECISION_LLM_LIVE_MODE.deferredOnly;
  const normalized = {
    mode,
    preferred,
    allowLlmFallback: asBoolean(policy.allowLlmFallback, false),
    requireDeterministicFulfillment: asBoolean(policy.requireDeterministicFulfillment, true),
    liveLlmMode,
  };
  const llmDefaults = DOMAIN_CONSTRAINTS?.llm && typeof DOMAIN_CONSTRAINTS.llm === "object"
    ? DOMAIN_CONSTRAINTS.llm
    : {};
  const model = asNonEmptyString(policy.model) || DEFAULT_LLM_MODEL;
  const baseUrl = asNonEmptyString(policy.baseUrl) || DEFAULT_LLM_BASE_URL;
  const format = asNonEmptyString(policy.format) || llmDefaults.outputFormat || "json";
  const options = normalizeJsonPromptOptions(policy.options) || normalizeJsonPromptOptions(llmDefaults.options);
  if (preferred === "llm" || mode === "llm") {
    normalized.model = model;
    normalized.baseUrl = baseUrl;
    normalized.format = format;
    if (options) normalized.options = options;
  }
  if (liveLlmMode === RUNTIME_DECISION_LLM_LIVE_MODE.manualNondeterministic) {
    normalized.requireDeterministicFulfillment = false;
  }
  return normalized;
}

export function allowsLiveLlmRuntime(providerPolicy = undefined) {
  const normalized = resolveRuntimeDecisionProviderPolicy(providerPolicy);
  return normalized.preferred === "llm"
    && normalized.mode === "llm"
    && normalized.liveLlmMode === RUNTIME_DECISION_LLM_LIVE_MODE.manualNondeterministic
    && normalized.requireDeterministicFulfillment === false;
}

export function buildRuntimeDecisionLlmPrompt({ requestEnvelope } = {}) {
  if (!isObject(requestEnvelope)) {
    throw new Error("runtime decision prompt requires requestEnvelope");
  }
  const actor = isObject(requestEnvelope.actor) ? requestEnvelope.actor : {};
  const visibleActors = Array.isArray(requestEnvelope.visibleActors) ? requestEnvelope.visibleActors : [];
  const hazards = Array.isArray(requestEnvelope.hazards) ? requestEnvelope.hazards : [];
  const candidateActions = Array.isArray(requestEnvelope.candidateActions) ? requestEnvelope.candidateActions : [];
  const promptPayload = {
    contract: RUNTIME_DECISION_CONTRACT,
    decisionKind: requestEnvelope.decisionKind || "next_move",
    phase: requestEnvelope.phase || "decide",
    tick: requestEnvelope.tick ?? 0,
    actor,
    visibleActors,
    hazards,
    objectives: requestEnvelope.objectives || undefined,
    constraints: requestEnvelope.constraints || undefined,
    candidateActions: candidateActions.map((entry) => ({
      id: entry.id,
      kind: entry.action?.kind || null,
      params: entry.action?.params || {},
    })),
  };

  return [
    "You are selecting the next gameplay action for a local dungeon runtime.",
    "Choose exactly one candidate action id from the provided candidateActions array.",
    "Return JSON only with this shape:",
    '{"decision":{"contract":"runtime-decision-v1","decisionKind":"next_move","selectedActionId":"candidate_id","selectedTargetId":"optional_target","confidence":0.0,"rationaleTags":["short_tag"]}}',
    "Do not return markdown or commentary.",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");
}

function unwrapCodeFence(text) {
  if (!text) return text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : text;
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = unwrapCodeFence(text).trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    return cleaned;
  }
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function extractLlmResponseText(payload) {
  if (!isObject(payload)) return null;
  if (asNonEmptyString(payload.response)) return payload.response;
  if (asNonEmptyString(payload.message?.content)) return payload.message.content;
  const choice = payload.choices?.[0];
  if (asNonEmptyString(choice?.message?.content)) return choice.message.content;
  if (asNonEmptyString(choice?.text)) return choice.text;
  return null;
}

export function parseRuntimeDecisionResponseText(responseText, { defaultDecisionKind = "next_move" } = {}) {
  const text = asNonEmptyString(responseText);
  if (!text) {
    return { responseParsed: null, errors: ["missing_llm_response_text"] };
  }
  const jsonText = extractJsonObject(text) || unwrapCodeFence(text) || text;
  try {
    const responseParsed = JSON.parse(jsonText);
    const normalized = normalizeRuntimeDecisionPayload(responseParsed, { defaultDecisionKind });
    if (!normalized.ok) {
      return { responseParsed, errors: normalized.errors };
    }
    return { responseParsed, errors: [] };
  } catch (error) {
    return { responseParsed: null, errors: [error?.message || "invalid_json"] };
  }
}

export function normalizeRuntimeDecisionPayload(payload, { defaultDecisionKind = "next_move" } = {}) {
  const decision = extractDecisionPayload(payload, { defaultDecisionKind });
  if (!decision) {
    return { ok: false, errors: ["missing_runtime_decision_payload"] };
  }
  const selectedActionId = asNonEmptyString(decision.selectedActionId);
  if (!selectedActionId) {
    return { ok: false, errors: ["missing_selected_action_id"] };
  }
  const value = {
    contract: decision.contract || RUNTIME_DECISION_CONTRACT,
    decisionKind: asDecisionKind(decision.decisionKind, defaultDecisionKind),
    selectedActionId,
  };
  const selectedTargetId = asNonEmptyString(decision.selectedTargetId);
  if (selectedTargetId) value.selectedTargetId = selectedTargetId;
  if (Number.isFinite(decision.confidence)) value.confidence = Number(decision.confidence);
  if (Array.isArray(decision.rationaleTags)) {
    value.rationaleTags = decision.rationaleTags.filter((entry) => asNonEmptyString(entry)).map((entry) => entry.trim());
  }
  const rankedCandidates = normalizeDecisionDiagnostics(decision.rankedCandidates, "candidateActionId");
  if (rankedCandidates.length > 0) value.rankedCandidates = rankedCandidates;
  const rejectedCandidates = normalizeDecisionDiagnostics(decision.rejectedCandidates, "candidateActionId");
  if (rejectedCandidates.length > 0) value.rejectedCandidates = rejectedCandidates;
  return { ok: true, value };
}

function resolveRuntimeDecisionAction({ decisionPayload, candidateActions, actorId, tick, defaultDecisionKind } = {}) {
  const normalizedDecision = normalizeRuntimeDecisionPayload(decisionPayload, { defaultDecisionKind });
  if (!normalizedDecision.ok) {
    return normalizedDecision;
  }
  const normalizedCandidates = normalizeCandidateActions(candidateActions, { actorId, tick });
  const selected = normalizedCandidates.find((candidate) => candidate.id === normalizedDecision.value.selectedActionId);
  if (!selected) {
    return { ok: false, errors: ["selected_action_missing_from_candidates"] };
  }
  const action = cloneAction(selected.action, { actorId, tick });
  if (!action || !asNonEmptyString(action.kind)) {
    return { ok: false, errors: ["selected_action_invalid"] };
  }
  return {
    ok: true,
    decision: normalizedDecision.value,
    candidate: selected,
    action,
  };
}

export function resolveActionFromSolverResult({ solverRequest, solverResult } = {}) {
  if (!isObject(solverRequest)) {
    return { ok: false, errors: ["missing_solver_request"] };
  }
  const status = asNonEmptyString(solverResult?.status);
  if (status && ["deferred", "error", "unsat", "unknown"].includes(status)) {
    return { ok: false, status, errors: [`solver_status_${status}`] };
  }
  const envelope = isObject(solverRequest.problem?.data) ? solverRequest.problem.data : null;
  if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) {
    return { ok: false, errors: ["missing_runtime_decision_envelope"] };
  }
  const decisionPayload = extractDecisionPayload(
    isObject(solverResult?.model) ? solverResult.model : solverResult,
    { defaultDecisionKind: envelope.decisionKind }
  );
  return resolveRuntimeDecisionAction({
    decisionPayload,
    candidateActions: envelope.candidateActions,
    actorId: envelope.actor?.id,
    tick: envelope.tick,
    defaultDecisionKind: envelope.decisionKind,
  });
}

export function resolveActionFromLlmCapture({ captureArtifact } = {}) {
  if (!isObject(captureArtifact)) {
    return { ok: false, errors: ["missing_capture_artifact"] };
  }
  const payload = isObject(captureArtifact.payload) ? captureArtifact.payload : null;
  if (!payload) {
    return { ok: false, errors: ["missing_capture_payload"] };
  }
  const envelope = isObject(payload.requestEnvelope) ? payload.requestEnvelope : null;
  if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) {
    return { ok: false, errors: ["missing_runtime_decision_envelope"] };
  }
  return resolveRuntimeDecisionAction({
    decisionPayload: payload.responseParsed,
    candidateActions: envelope.candidateActions,
    actorId: envelope.actor?.id,
    tick: envelope.tick,
    defaultDecisionKind: envelope.decisionKind,
  });
}
