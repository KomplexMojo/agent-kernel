import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DOMAIN_CONSTRAINTS,
} from "../../contracts/domain-constants.js";
import { ACTION_SCHEMA } from "../../contracts/artifacts.ts";


type JsonRecord = Record<string, unknown>;
type ProviderMode = "solver" | "llm" | "auto";
type LiveLlmMode = "deferred_only" | "manual_nondeterministic";

type ActionRecord = JsonRecord & {
  id?: string; schema?: string; schemaVersion?: number; actorId?: string;
  tick?: number; kind?: string; params?: JsonRecord;
};

type CandidateAction = JsonRecord & { id: string; action: ActionRecord };

type RuntimeDecisionProviderPolicy = {
  mode: ProviderMode; preferred: ProviderMode; liveLlmMode: LiveLlmMode;
  allowLlmFallback: boolean; requireDeterministicFulfillment: boolean;
  model?: string; baseUrl?: string; format?: string; options?: JsonRecord;
};

type RuntimeDecisionEnvelope = JsonRecord & {
  contract: string; decisionKind: string; phase: string; tick: number;
  actor: JsonRecord; candidateActions: CandidateAction[];
  providerPolicy: RuntimeDecisionProviderPolicy;
  visibleActors?: JsonRecord[]; hazards?: JsonRecord[];
  objectives?: JsonRecord; constraints?: JsonRecord;
};

type RuntimeDecisionValue = JsonRecord & {
  contract: string; decisionKind: string; selectedActionId: string;
  selectedTargetId?: string; confidence?: number; rationaleTags?: string[];
  rankedCandidates?: JsonRecord[]; rejectedCandidates?: JsonRecord[];
};

type DecisionFailure = { ok: false; errors: string[]; status?: string };
type DecisionPayloadSuccess = { ok: true; value: RuntimeDecisionValue };

type ResolvedRuntimeDecision = {
  ok: true; decision: RuntimeDecisionValue; candidate: CandidateAction; action: ActionRecord;
};

type RuntimeDecisionResult = DecisionFailure | ResolvedRuntimeDecision;

export const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";
export const RUNTIME_DECISION_LLM_LIVE_MODE = Object.freeze({
  deferredOnly: "deferred_only",
  manualNondeterministic: "manual_nondeterministic",
});

function isObject(value: unknown): value is JsonRecord;
function isObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecisionKind(value: unknown, fallback = "next_move") {
  return asNonEmptyString(value) || fallback;
}

function asTick(value: unknown, fallback = 0) {
  if (Number.isInteger(value)) return value as number;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneAction(
  action: unknown,
  { actorId, tick }: { actorId?: string | null; tick?: number } = {},
): ActionRecord | null {
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

function normalizeCandidateAction(
  candidate: unknown,
  index: number,
  { actorId, tick }: { actorId?: string | null; tick?: number } = {},
): CandidateAction | null {
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

function normalizeCandidateActions(
  candidateActions: unknown,
  { actorId, tick }: { actorId?: string | null; tick?: number } = {},
): CandidateAction[] {
  const list = Array.isArray(candidateActions) ? candidateActions : [];
  return list
    .map((candidate, index) => normalizeCandidateAction(candidate, index, { actorId, tick }))
    .filter(Boolean) as CandidateAction[];
}

function normalizeProviderMode(value: unknown): ProviderMode | null {
  const normalized = asNonEmptyString(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "solver" || lowered === "llm" || lowered === "auto") {
    return lowered;
  }
  return null;
}

function normalizeLiveLlmMode(value: unknown): LiveLlmMode | null {
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

function normalizeDecisionDiagnostics(entries: unknown, key: string): JsonRecord[] {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .filter((entry) => isObject(entry) && asNonEmptyString(entry[key]))
    .map((entry) => ({ ...(entry as JsonRecord), [key]: ((entry as JsonRecord)[key] as string).trim() }));
}

function normalizeJsonPromptOptions(value: unknown) {
  if (!isObject(value)) return undefined;
  return cloneJson(value);
}

function extractDecisionPayload(
  raw: unknown,
  { defaultDecisionKind = "next_move" }: { defaultDecisionKind?: string } = {},
): JsonRecord | null {
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
}: {
  decisionKind?: string;
  phase?: string;
  tick?: unknown;
  actor?: unknown;
  visibleActors?: unknown[];
  hazards?: unknown[];
  candidateActions?: unknown[];
  objectives?: unknown;
  constraints?: unknown;
  providerPolicy?: unknown;
} = {}): RuntimeDecisionEnvelope {
  const actorRecord = isObject(actor) ? { ...actor } : {};
  const actorId = asNonEmptyString(actorRecord.id) || null;
  const resolvedTick = asTick(tick, 0);
  const normalizedCandidates = normalizeCandidateActions(candidateActions, { actorId, tick: resolvedTick });
  const normalizedPolicy = resolveRuntimeDecisionProviderPolicy(providerPolicy);
  const envelope: RuntimeDecisionEnvelope = {
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

export function resolveRuntimeDecisionProviderPolicy(
  providerPolicy: unknown = undefined,
): RuntimeDecisionProviderPolicy {
  const policy = isObject(providerPolicy) ? providerPolicy : {};
  const mode = normalizeProviderMode(policy.mode) || "auto";
  const preferred = normalizeProviderMode(policy.preferred) || (mode === "llm" ? "llm" : "solver");
  const liveLlmMode = normalizeLiveLlmMode(policy.liveLlmMode)
    || RUNTIME_DECISION_LLM_LIVE_MODE.deferredOnly;
  const normalized: RuntimeDecisionProviderPolicy = {
    mode,
    preferred,
    allowLlmFallback: asBoolean(policy.allowLlmFallback, false),
    requireDeterministicFulfillment: asBoolean(policy.requireDeterministicFulfillment, true),
    liveLlmMode,
  };
  const llmDefaults: JsonRecord = DOMAIN_CONSTRAINTS?.llm && typeof DOMAIN_CONSTRAINTS.llm === "object"
    ? DOMAIN_CONSTRAINTS.llm as JsonRecord
    : {};
  const model = asNonEmptyString(policy.model) || DEFAULT_LLM_MODEL;
  const baseUrl = asNonEmptyString(policy.baseUrl) || DEFAULT_LLM_BASE_URL;
  const format = asNonEmptyString(policy.format) || llmDefaults.outputFormat as string || "json";
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

export function allowsLiveLlmRuntime(providerPolicy: unknown = undefined) {
  const normalized = resolveRuntimeDecisionProviderPolicy(providerPolicy);
  return normalized.preferred === "llm"
    && normalized.mode === "llm"
    && normalized.liveLlmMode === RUNTIME_DECISION_LLM_LIVE_MODE.manualNondeterministic
    && normalized.requireDeterministicFulfillment === false;
}

export function buildRuntimeDecisionLlmPrompt(
  { requestEnvelope }: { requestEnvelope?: unknown } = {},
) {
  if (!isObject(requestEnvelope)) {
    throw new Error("runtime decision prompt requires requestEnvelope");
  }
  const actor = isObject(requestEnvelope.actor) ? requestEnvelope.actor : {};
  const visibleActors = Array.isArray(requestEnvelope.visibleActors) ? requestEnvelope.visibleActors : [];
  const hazards = Array.isArray(requestEnvelope.hazards) ? requestEnvelope.hazards : [];
  const candidateActions = (Array.isArray(requestEnvelope.candidateActions) ? requestEnvelope.candidateActions : []) as CandidateAction[];
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

function unwrapCodeFence(text: string) {
  if (!text) return text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : text;
}

function extractJsonObject(text: string) {
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

export function extractLlmResponseText(payload: unknown) {
  if (!isObject(payload)) return null;
  if (asNonEmptyString(payload.response)) return payload.response;
  if (asNonEmptyString((payload.message as JsonRecord | undefined)?.content)) return (payload.message as JsonRecord).content as string;
  const choice = (payload.choices as JsonRecord[] | undefined)?.[0];
  if (asNonEmptyString((choice?.message as JsonRecord | undefined)?.content)) return (choice?.message as JsonRecord).content as string;
  if (asNonEmptyString(choice?.text)) return (choice as JsonRecord).text as string;
  return null;
}

export function parseRuntimeDecisionResponseText(
  responseText: unknown,
  { defaultDecisionKind = "next_move" }: { defaultDecisionKind?: string } = {},
) {
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
    return { responseParsed: null, errors: [(error as { message?: string })?.message || "invalid_json"] };
  }
}

export function normalizeRuntimeDecisionPayload(
  payload: unknown,
  { defaultDecisionKind = "next_move" }: { defaultDecisionKind?: string } = {},
): DecisionFailure | DecisionPayloadSuccess {
  const decision = extractDecisionPayload(payload, { defaultDecisionKind });
  if (!decision) {
    return { ok: false, errors: ["missing_runtime_decision_payload"] };
  }
  const selectedActionId = asNonEmptyString(decision.selectedActionId);
  if (!selectedActionId) {
    return { ok: false, errors: ["missing_selected_action_id"] };
  }
  const value: RuntimeDecisionValue = {
    contract: decision.contract as string || RUNTIME_DECISION_CONTRACT,
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

function resolveRuntimeDecisionAction({
  decisionPayload,
  candidateActions,
  actorId,
  tick,
  defaultDecisionKind
}: {
  decisionPayload?: unknown;
  candidateActions?: unknown;
  actorId?: string | null;
  tick?: number;
  defaultDecisionKind?: string;
} = {}): RuntimeDecisionResult {
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

export function resolveActionFromSolverResult({
  solverRequest,
  solverResult
}: {
  solverRequest?: unknown;
  solverResult?: unknown;
} = {}): RuntimeDecisionResult {
  if (!isObject(solverRequest)) {
    return { ok: false, errors: ["missing_solver_request"] };
  }
  const status = asNonEmptyString((solverResult as JsonRecord | null)?.status);
  if (status && ["deferred", "error", "unsat", "unknown"].includes(status)) {
    return { ok: false, status, errors: [`solver_status_${status}`] };
  }
  const envelope = isObject((solverRequest.problem as JsonRecord | undefined)?.data) ? (solverRequest.problem as JsonRecord).data as JsonRecord : null;
  if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) {
    return { ok: false, errors: ["missing_runtime_decision_envelope"] };
  }
  const decisionPayload = extractDecisionPayload(isObject((solverResult as JsonRecord | null)?.model) ? (solverResult as JsonRecord).model : solverResult, { defaultDecisionKind: envelope.decisionKind as string | undefined });
  return resolveRuntimeDecisionAction({
    decisionPayload,
    candidateActions: envelope.candidateActions,
    actorId: (envelope.actor as JsonRecord | undefined)?.id as string | undefined,
    tick: envelope.tick as number | undefined,
    defaultDecisionKind: envelope.decisionKind as string | undefined,
  });
}

export function resolveActionFromLlmCapture(
  { captureArtifact }: { captureArtifact?: unknown } = {},
): RuntimeDecisionResult {
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
    actorId: (envelope.actor as JsonRecord | undefined)?.id as string | undefined,
    tick: envelope.tick as number | undefined,
    defaultDecisionKind: envelope.decisionKind as string | undefined,
  });
}
