import { createDirectorStateMachine, DirectorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";
import { buildSolverRequestEffect } from "../_shared/persona-helpers.js";

const PLAN_ARTIFACT_SCHEMA = "agent-kernel/PlanArtifact";
const INTENT_SCHEMA = "agent-kernel/IntentEnvelope";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveIntentEnvelope(payload) {
  if (payload?.intentEnvelope && typeof payload.intentEnvelope === "object") {
    return payload.intentEnvelope;
  }
  if (payload?.intent && typeof payload.intent === "object" && payload.intent.meta) {
    return payload.intent;
  }
  return null;
}

function resolveIntentRef(payload, intentEnvelope) {
  const ref = payload?.intentRef;
  if (ref && typeof ref === "object") {
    return ref;
  }
  if (isNonEmptyString(ref)) {
    return { id: ref, schema: INTENT_SCHEMA, schemaVersion: 1 };
  }
  if (intentEnvelope?.meta?.id) {
    return {
      id: intentEnvelope.meta.id,
      schema: intentEnvelope.schema || INTENT_SCHEMA,
      schemaVersion: intentEnvelope.schemaVersion || 1,
    };
  }
  return null;
}

function buildPlanArtifactFromIntent({ intentEnvelope, intentRef, runId, clock, tick }) {
  if (!intentRef) return null;
  const goal = intentEnvelope?.intent?.goal;
  const objectiveDescription = isNonEmptyString(goal) ? goal : `Objective for ${intentRef.id}`;
  const tags = Array.isArray(intentEnvelope?.intent?.tags) ? intentEnvelope.intent.tags.slice() : [];
  const hints = intentEnvelope?.intent?.hints && typeof intentEnvelope.intent.hints === "object"
    ? { ...intentEnvelope.intent.hints }
    : null;
  const resolvedRunId = runId || intentEnvelope?.meta?.runId || "run_director";
  const createdAt = typeof clock === "function" ? clock() : new Date().toISOString();
  return {
    schema: PLAN_ARTIFACT_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: `plan_${resolvedRunId}_${Number.isFinite(tick) ? tick : 0}`,
      runId: resolvedRunId,
      createdAt,
      producedBy: "director",
      correlationId: intentRef.id,
    },
    intentRef,
    plan: {
      objectives: [
        {
          id: "objective_1",
          description: objectiveDescription,
          priority: 1,
        },
      ],
      ...(tags.length > 0 ? { theme: { tags } } : {}),
    },
    ...(hints ? { directives: hints } : {}),
  };
}

function resolvePlanArtifact({ event, payload, tick, clock }) {
  const intentEnvelope = resolveIntentEnvelope(payload);
  const intentRef = resolveIntentRef(payload, intentEnvelope);
  if (payload?.planArtifact) {
    const planRef = payload.planRef || {
      id: payload.planArtifact.meta?.id,
      schema: payload.planArtifact.schema,
      schemaVersion: payload.planArtifact.schemaVersion,
    };
    return { planArtifact: payload.planArtifact, planRef, intentRef };
  }
  if (event !== "ingest_intent") {
    return { planArtifact: null, planRef: payload?.planRef ?? null, intentRef };
  }
  const planArtifact = buildPlanArtifactFromIntent({
    intentEnvelope,
    intentRef,
    runId: payload?.runId,
    clock,
    tick,
  });
  if (!planArtifact) {
    return { planArtifact: null, planRef: payload?.planRef ?? null, intentRef };
  }
  const planRef = {
    id: planArtifact.meta?.id,
    schema: planArtifact.schema,
    schemaVersion: planArtifact.schemaVersion,
  };
  return { planArtifact, planRef, intentRef };
}

// Phases this persona listens to (others are ignored).
export const directorSubscribePhases = Object.freeze([TickPhases.DECIDE]);

// Phase-aware Director persona wrapper. Pure/deterministic; no IO.
export function createDirectorPersona({ initialState = DirectorStates.UNINITIALIZED, clock = () => new Date().toISOString() } = {}) {
  const fsm = createDirectorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!directorSubscribePhases.includes(phase)) {
      const snapshot = view();
      return { ...snapshot, actions: [], effects: [], artifacts: [], telemetry: null };
    }
    if (!event) {
      const snapshot = view();
      return { ...snapshot, actions: [], effects: [], artifacts: [], telemetry: null };
    }
    const resolved = resolvePlanArtifact({ event, payload, tick, clock });
    const payloadWithPlan = resolved.planRef
      ? { ...payload, planRef: resolved.planRef, planArtifact: resolved.planArtifact, intentRef: resolved.intentRef ?? payload.intentRef }
      : payload;
    const result = fsm.advance(event, payloadWithPlan);
    const effects = [];
    const artifacts = [];
    const solverEffect = buildSolverRequestEffect({
      solverRequest: payload.solver || payload.solverRequest,
      intentRef: payloadWithPlan.intentRef,
      planRef: payloadWithPlan.planRef,
      personaRef: "director",
      targetAdapter: payload.targetAdapter,
    });
    if (solverEffect) {
      effects.push(solverEffect);
      result.context = { ...result.context, lastSolverRequest: solverEffect.request };
    }
    if (resolved.planArtifact) {
      artifacts.push(resolved.planArtifact);
    }
    return {
      ...result,
      tick,
      actions: [],
      effects,
      artifacts,
      telemetry: null,
    };
  }

  return {
    advance,
    view,
    subscribePhases: directorSubscribePhases,
  };
}
