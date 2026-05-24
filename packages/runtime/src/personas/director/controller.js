import { createDirectorStateMachine, DirectorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildSolverRequestEffect } from "../_shared/persona-helpers.mts";
import { computeBudgetPools } from "./budget-allocation.js";

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

const LAYOUT_POOL_ID = "rooms";
const HAZARD_PROPOSAL_KIND = "hazard_proposal";
const ARTIFACT_PROPOSAL_KIND = "artifact_proposal";
const DEFAULT_ARTIFACT_VITAL_KEY = "health";
const DEFAULT_ARTIFACT_DELTA = 10;

/**
 * For each room hint that carries an affinity, emit one hazard_proposal effect.
 * The budgetCeiling is derived from the layout pool share of the total budget.
 */
function buildHazardProposalEffects({ intentEnvelope, planRef, personaRef = "director" }) {
  const hints = intentEnvelope?.intent?.hints;
  if (!hints || typeof hints !== "object") return [];
  const rooms = Array.isArray(hints.rooms) ? hints.rooms : [];
  const affinityRooms = rooms
    .map((room, idx) => ({ room, idx }))
    .filter(({ room }) => typeof room?.affinity === "string" && room.affinity.trim().length > 0);
  if (affinityRooms.length === 0) return [];

  const budgetTokens = Number.isInteger(hints.budgetTokens) && hints.budgetTokens > 0
    ? hints.budgetTokens
    : 0;
  const pools = budgetTokens > 0
    ? computeBudgetPools({ budgetTokens }).pools
    : [];
  const layoutPool = pools.find((p) => p.id === LAYOUT_POOL_ID);
  const budgetCeiling = layoutPool ? layoutPool.tokens : 0;

  return affinityRooms.map(({ room, idx }) => ({
    kind: HAZARD_PROPOSAL_KIND,
    affinity: room.affinity.trim(),
    roomIndex: idx,
    budgetCeiling,
    personaRef,
    ...(planRef ? { planRef } : {}),
  }));
}

/**
 * For each affinity-tagged room, emit one artifact_proposal effect.
 * Higher-affinity rooms receive a proportionally higher budgetCeiling.
 * Total artifact spend is capped by hints.dungeonBreakdown.artifacts.
 */
function buildArtifactProposalEffects({ intentEnvelope, planRef, personaRef = "director" }) {
  const hints = intentEnvelope?.intent?.hints;
  if (!hints || typeof hints !== "object") return [];
  const rooms = Array.isArray(hints.rooms) ? hints.rooms : [];
  const affinityRooms = rooms
    .map((room, idx) => ({ room, idx }))
    .filter(({ room }) => typeof room?.affinity === "string" && room.affinity.trim().length > 0);
  if (affinityRooms.length === 0) return [];

  const artifactBudget =
    typeof hints.dungeonBreakdown === "object" &&
    hints.dungeonBreakdown !== null &&
    Number.isInteger(hints.dungeonBreakdown.artifacts) &&
    hints.dungeonBreakdown.artifacts > 0
      ? hints.dungeonBreakdown.artifacts
      : 0;

  const perRoomBudget =
    artifactBudget > 0 ? Math.floor(artifactBudget / affinityRooms.length) : 0;

  return affinityRooms.map(({ room, idx }) => {
    const vitalKey = typeof room.artifactVitalKey === "string" && room.artifactVitalKey
      ? room.artifactVitalKey
      : DEFAULT_ARTIFACT_VITAL_KEY;
    const delta = perRoomBudget > 0 ? perRoomBudget : DEFAULT_ARTIFACT_DELTA;
    const vitals = Array.isArray(room.artifactVitals) && room.artifactVitals.length > 0
      ? room.artifactVitals
      : [{ key: vitalKey, delta }];
    return {
      kind: ARTIFACT_PROPOSAL_KIND,
      affinity: room.affinity.trim(),
      roomIndex: idx,
      vitals,
      permanent: room.artifactPermanent === true,
      budgetCeiling: perRoomBudget,
      personaRef,
      ...(planRef ? { planRef } : {}),
    };
  });
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
    if (event === "ingest_intent") {
      const resolvedEnvelope = resolveIntentEnvelope(payload);
      const hazardEffects = buildHazardProposalEffects({
        intentEnvelope: resolvedEnvelope,
        planRef: payloadWithPlan.planRef,
        personaRef: "director",
      });
      effects.push(...hazardEffects);
      const artifactEffects = buildArtifactProposalEffects({
        intentEnvelope: resolvedEnvelope,
        planRef: payloadWithPlan.planRef,
        personaRef: "director",
      });
      effects.push(...artifactEffects);
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
