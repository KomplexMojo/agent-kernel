const ACTION_SCHEMA = "agent-kernel/Action";
const TELEMETRY_SCHEMA = "agent-kernel/TelemetryRecord";
const RUN_SUMMARY_SCHEMA = "agent-kernel/RunSummary";

function stableId(parts) {
  return parts.filter(Boolean).join("_");
}

export function buildAction({ tick = 0, kind, actorId = "persona", params = {}, personaRef }) {
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

export function buildSolverRequestEffect({ solverRequest = null, intentRef, planRef, personaRef, targetAdapter = "fixtures" }) {
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

export function buildRequestActionsFromEffects(effects = [], { tick = 0, personaRef = "persona", actorId = "persona", budgetRemaining = Infinity } = {}) {
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

export function buildTelemetry({ observations = [], runId = "run", clock = () => new Date().toISOString(), personaRef = "annotator" }) {
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
        createdAt: clock(),
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
      createdAt: clock(),
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
