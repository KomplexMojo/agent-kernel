import { requireClock } from "./require-clock.js";
import { LLM_REQUEST_SCHEMA, LLM_REQUEST_EFFECT_KIND } from "../../contracts/llm-protocol.js";
const ACTION_SCHEMA = "agent-kernel/Action";
const TELEMETRY_SCHEMA = "agent-kernel/TelemetryRecord";
const RUN_SUMMARY_SCHEMA = "agent-kernel/RunSummary";

type JsonRecord = Record<string, unknown>;

type ArtifactRef = JsonRecord & { id?: string };

type SolverRequest = JsonRecord & {
  id?: string;
  requestId?: string;
  targetAdapter?: string;
  intentRef?: ArtifactRef;
  planRef?: ArtifactRef;
  problem?: unknown;
};

type PersonaEffect = JsonRecord & {
  kind?: string;
  id?: string;
  requestId?: string;
  tick?: number;
  sourceRef?: ArtifactRef;
  targetAdapter?: string;
};

type PersonaObservation = JsonRecord & {
  tick?: number;
  persona?: string;
  effects?: PersonaEffect[];
  fulfilledEffects?: PersonaEffect[];
  notes?: unknown;
};

function stableId(parts: Array<string | number | null | undefined | false>) {
  return parts.filter(Boolean).join("_");
}

export function buildAction({
  tick = 0,
  kind,
  actorId = "persona",
  params = {},
  personaRef
}: {
  tick?: number;
  kind: string;
  actorId?: string;
  params?: JsonRecord;
  personaRef?: string;
}) {
  return {
    schema: ACTION_SCHEMA,
    schemaVersion: 1,
    actorId,
    tick,
    kind,
    params,
    personaRef,
  };
}

export function buildSolverRequestEffect({
  solverRequest = null,
  intentRef,
  planRef,
  personaRef,
  targetAdapter = "fixtures"
}: {
  solverRequest?: SolverRequest | null;
  intentRef?: ArtifactRef;
  planRef?: ArtifactRef;
  personaRef?: string;
  targetAdapter?: string;
}) {
  const hasRequest = solverRequest && Object.keys(solverRequest).length > 0;
  if (!hasRequest && !planRef && !intentRef) {
    return null;
  }
  const baseRequest = hasRequest ? solverRequest : {};
  const requestId = baseRequest.requestId || baseRequest.id || stableId(["solver", planRef?.id || intentRef?.id || "req"]);
  const request = {
    ...baseRequest,
    id: requestId,
    requestId,
    targetAdapter: baseRequest.targetAdapter || targetAdapter,
    intentRef: baseRequest.intentRef || intentRef,
    planRef: baseRequest.planRef || planRef,
    problem: baseRequest.problem || { language: "custom", data: {} },
  };
  return {
    kind: "solver_request",
    request,
    requestId,
    targetAdapter: request.targetAdapter,
    personaRef,
  };
}

/**
 * FNV-1a over the prompt, so a request id is DERIVED rather than generated.
 *
 * A counter or a random id would make two identical rounds produce different artifacts,
 * and replay compares artifacts. The prompt is the only input that distinguishes one
 * request from the next within a phase, and it is far too long to put in an id.
 */
function promptFingerprint(prompt: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < prompt.length; index += 1) {
    hash ^= prompt.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Build the LLM request the Orchestrator RETURNS instead of performing (CR.4).
 *
 * Mirrors `buildSolverRequestEffect`: the persona emits an effect as data, the host
 * dispatches it through `ports/effects.js`, and the ADAPTER does the IO. Returns `null`
 * when the request could not be made well-formed — a caller with no model or no prompt
 * has nothing to ask, and emitting a half-formed request would push the failure into the
 * adapter where it reads as an IO error rather than a programming one.
 */
export function buildLlmRequestEffect({
  model,
  prompt,
  phase,
  options,
  format,
  stream,
  baseUrl,
  personaRef = "orchestrator"
}: {
  model?: string;
  prompt?: string;
  phase?: string;
  options?: JsonRecord;
  format?: string;
  stream?: boolean;
  baseUrl?: string;
  personaRef?: string;
}) {
  const hasModel = typeof model === "string" && model.trim().length > 0;
  const hasPrompt = typeof prompt === "string" && prompt.trim().length > 0;
  if (!hasModel || !hasPrompt) {
    return null;
  }

  const requestId = stableId(["llm", phase, model, promptFingerprint(prompt as string)]);
  const request = {
    schema: LLM_REQUEST_SCHEMA,
    schemaVersion: 1,
    requestId,
    model,
    prompt,
    ...(phase ? { phase } : {}),
    ...(options && typeof options === "object" ? { options } : {}),
    ...(typeof format === "string" && format ? { format } : {}),
    ...(stream === undefined ? {} : { stream: Boolean(stream) }),
    ...(baseUrl ? { baseUrl } : {}),
  };

  return {
    kind: LLM_REQUEST_EFFECT_KIND,
    request,
    requestId,
    personaRef,
  };
}

export function buildRequestActionsFromEffects(
  effects: PersonaEffect[] = [],
  {
    tick = 0,
    personaRef = "persona",
    actorId = "persona",
    budgetRemaining = Infinity
  }: {
    tick?: number;
    personaRef?: string;
    actorId?: string;
    budgetRemaining?: number;
  } = {},
) {
  const actions = [];
  let remaining = budgetRemaining;
  for (const effect of effects) {
    if (remaining <= 0) {
      break;
    }
    if (effect?.kind !== "need_external_fact") {
      continue;
    }
    const requestId = effect.requestId || effect.id || stableId(["req", effect.tick, effect.kind]);
    if (effect.sourceRef) {
      actions.push(
        buildAction({
          tick,
          kind: "fulfill_request",
          actorId,
          personaRef,
          params: { requestId, sourceRef: effect.sourceRef, targetAdapter: effect.targetAdapter },
        }),
      );
    } else {
      actions.push(
        buildAction({
          tick,
          kind: "defer_request",
          actorId,
          personaRef,
          params: { requestId, reason: "missing_source_ref", targetAdapter: effect.targetAdapter },
        }),
      );
    }
    remaining -= 1;
  }
  return { actions, remaining };
}

export function buildTelemetry({
  observations = [],
  runId = "run",
  clock,
  personaRef = "annotator"
}: {
  observations?: PersonaObservation[];
  runId?: string;
  clock?: () => string;
  personaRef?: string;
}) {
  const records = [];
  let effectsTotal = 0;
  for (const obs of observations) {
    const effectKinds = Array.isArray(obs.effects) ? obs.effects.map((e) => e.kind) : [];
    const fulfilled = Array.isArray(obs.fulfilledEffects) ? obs.fulfilledEffects.length : 0;
    const tick = obs.tick ?? 0;
    const metaId = stableId(["telemetry", personaRef, tick.toString()]);
    records.push({
      schema: TELEMETRY_SCHEMA,
      schemaVersion: 1,
      meta: {
        id: metaId,
        runId,
        createdAt: requireClock(clock, personaRef)(),
        producedBy: personaRef,
      },
      scope: "tick",
      tick,
      persona: obs.persona || personaRef,
      data: {
        effectKinds,
        effectCount: effectKinds.length,
        fulfilledCount: fulfilled,
        notes: obs.notes || null,
      },
    });
    effectsTotal += effectKinds.length;
  }

  const summary = {
    schema: RUN_SUMMARY_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: stableId(["run_summary", personaRef, runId]),
      runId,
      createdAt: requireClock(clock, personaRef)(),
      producedBy: personaRef,
    },
    outcome: "unknown",
    metrics: {
      ticksObserved: observations.length,
      totalEffects: effectsTotal,
    },
    highlights: [`observed ${observations.length} ticks`, `${effectsTotal} effects`],
  };

  return { records, summary };
}
