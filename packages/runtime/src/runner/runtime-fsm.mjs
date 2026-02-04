import { applyBudgetCaps } from "../ports/budget.js";
import * as effects from "../ports/effects.js";
import { createSolverPort } from "../ports/solver.js";
import { createTickOrchestrator } from "../personas/_shared/tick-orchestrator.js";
import { TickPhases } from "../personas/_shared/tick-state-machine.js";
import { createActorPersona } from "../personas/actor/persona.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createAnnotatorPersona } from "../personas/annotator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createDirectorPersona } from "../personas/director/persona.js";
import { createModeratorPersona } from "../personas/moderator/persona.js";
import { createOrchestratorPersona } from "../personas/orchestrator/persona.js";
import { applyInitialStateToCore, applySimConfigToCore } from "./core-setup.mjs";
import { applyMoveAction, packMoveAction, readObservation, renderBaseTiles } from "../../../bindings-ts/src/index.js";

const ACTION_KIND = Object.freeze({
  IncrementCounter: 1,
  EmitLog: 2,
  EmitTelemetry: 3,
  RequestExternalFact: 4,
  RequestSolver: 5,
  FulfillRequest: 6,
  DeferRequest: 7,
  Move: 8,
});

const DEFAULT_PERSONA_ORDER = Object.freeze([
  "orchestrator",
  "director",
  "configurator",
  "allocator",
  "actor",
  "moderator",
  "annotator",
]);

const DEFAULT_LOG_LEVELS = Object.freeze({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
});

const PLAN_ARTIFACT_SCHEMA = "agent-kernel/PlanArtifact";

function toInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function normalizeLogLevel(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(3, Math.trunc(value)));
  }
  const key = String(value || "info").toLowerCase();
  return DEFAULT_LOG_LEVELS[key] ?? DEFAULT_LOG_LEVELS.info;
}

function stableHashByte(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash & 0xff;
}

function parseRequestSequence(requestId) {
  if (!requestId) return null;
  const match = String(requestId).match(/(\d+)$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function ensureRecord(value, label) {
  if (value === null || value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value;
}

function normalizePersonaPayloadsMap(raw) {
  return ensureRecord(raw, "personaPayloads");
}

function normalizePersonaEventsMap(raw) {
  const events = ensureRecord(raw, "personaEvents");
  const normalized = {};
  for (const [key, value] of Object.entries(events)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.map((entry) => {
        if (typeof entry !== "string") {
          throw new Error(`personaEvents.${key} entries must be strings.`);
        }
        return entry;
      });
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`personaEvents.${key} must be a string or string array.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function findPlanArtifact(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  for (let i = artifacts.length - 1; i >= 0; i -= 1) {
    const artifact = artifacts[i];
    if (artifact?.schema === PLAN_ARTIFACT_SCHEMA) {
      return artifact;
    }
  }
  return null;
}

function resolveMoveDirection({ direction, from, to }) {
  if (direction !== undefined && direction !== null) return direction;
  if (!from || !to) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "east";
  if (dx === -1 && dy === 0) return "west";
  if (dx === 0 && dy === -1) return "north";
  if (dx === 0 && dy === 1) return "south";
  return null;
}

function buildActorIdMap(initialState) {
  const map = new Map();
  const actors = Array.isArray(initialState?.actors)
    ? initialState.actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))
    : [];
  actors.forEach((actor, index) => {
    if (actor?.id) {
      map.set(String(actor.id), index + 1);
    }
  });
  return { map, primaryActorId: actors[0]?.id || "actor" };
}

function canRenderBaseTiles(core) {
  return typeof core?.getMapWidth === "function"
    && typeof core?.getMapHeight === "function"
    && typeof core?.renderBaseCellChar === "function";
}

function canReadObservation(core) {
  return typeof core?.getMapWidth === "function"
    && typeof core?.getMapHeight === "function"
    && typeof core?.getActorX === "function"
    && typeof core?.getActorY === "function"
    && typeof core?.getActorKind === "function"
    && typeof core?.getActorVitalCurrent === "function"
    && typeof core?.getActorVitalMax === "function"
    && typeof core?.getActorVitalRegen === "function"
    && typeof core?.getTileActorKind === "function"
    && typeof core?.getCurrentTick === "function";
}

function resolveBaseTiles(simConfig, core) {
  const tiles = simConfig?.layout?.data?.tiles;
  if (Array.isArray(tiles)) return tiles;
  if (core && canRenderBaseTiles(core)) {
    try {
      return renderBaseTiles(core);
    } catch {
      return null;
    }
  }
  return null;
}

function resolveObservation(core, actorIdLabel) {
  if (!core || !canReadObservation(core)) return null;
  try {
    return readObservation(core, { actorIdLabel });
  } catch {
    return null;
  }
}

function buildEffectRecordFactory({ core, effectFactory, tick }) {
  const buildEffectFromCore = typeof effects.buildEffectFromCore === "function"
    ? effects.buildEffectFromCore
    : ({ tick: t, index: i, kind: k, value: v }) => ({
        schema: "agent-kernel/Effect",
        schemaVersion: 1,
        id: `eff_${t}_${i}_${k}_${v}`,
        tick: t,
        fulfillment: "deterministic",
        kind: "custom",
        data: { kind: k, value: v },
      });

  return ({ kind, value, index }) => {
    const fallback = buildEffectFromCore({ tick, index, kind, value });
    if (typeof effectFactory === "function") {
      const customEffect = effectFactory({ tick, kind, value, index });
      if (customEffect) {
        return { ...fallback, ...customEffect, id: customEffect.id || fallback.id };
      }
    }
    return fallback;
  };
}

function normalizeEffectKind(effect) {
  if (!effect || typeof effect.kind === "string" || typeof effect.kind === "number") {
    return;
  }
  if (effect.kind && typeof effect.kind.kind === "string") {
    effect.kind = effect.kind.kind;
    return;
  }
  if (effect.kind && typeof effect.kind.type === "string") {
    effect.kind = effect.kind.type;
    return;
  }
  effect.kind = String(effect.kind);
}

function flushEffects({ core, adapters, effectFactory, tick, effectLog }) {
  const count = core.getEffectCount();
  const buildEffectRecord = buildEffectRecordFactory({ core, effectFactory, tick });
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const kind = core.getEffectKind(i);
    const value = core.getEffectValue(i);
    const effect = buildEffectRecord({ kind, value, index: i });
    normalizeEffectKind(effect);
    let outcome;
    if (effect?.kind === "need_external_fact") {
      if (effect.sourceRef) {
        effect.fulfillment = "deterministic";
        outcome = {
          status: "fulfilled",
          result: { sourceRef: effect.sourceRef, requestId: effect.requestId, targetAdapter: effect.targetAdapter },
        };
      } else {
        effect.fulfillment = "deferred";
        outcome = { status: "deferred", reason: "missing_source_ref" };
      }
    } else if (effect?.fulfillment === "deferred") {
      outcome = { status: "deferred", reason: "deferred_effect" };
    } else {
      const dispatch = typeof effects.dispatchEffect === "function"
        ? effects.dispatchEffect
        : () => ({ status: "deferred", reason: "missing_dispatchEffect" });
      outcome = dispatch(adapters, effect);
    }
    records.push({
      effect,
      outcome,
      index: i,
      coreKind: kind,
      coreValue: value,
    });
  }
  core.clearEffects();

  records.sort((a, b) => {
    const left = a.effect?.id || "";
    const right = b.effect?.id || "";
    if (left === right) {
      return a.index - b.index;
    }
    return left < right ? -1 : 1;
  });

  const emittedEffects = records.map((record) => record.effect);
  const fulfilledEffects = records.map((record) => ({
    effect: record.effect,
    status: record.outcome?.status || "fulfilled",
    result: record.outcome?.result,
    reason: record.outcome?.reason,
    requestId: record.effect?.requestId,
  }));

  for (const record of records) {
    effectLog.push({
      tick,
      kind: record.effect?.kind ?? record.coreKind,
      value: record.coreValue,
      effectId: record.effect?.id,
      requestId: record.effect?.requestId,
      status: record.outcome?.status || "fulfilled",
      result: record.outcome?.result,
      reason: record.outcome?.reason,
    });
  }

  return { emittedEffects, fulfilledEffects };
}

function buildDefaultPersonas({ clock }) {
  return {
    orchestrator: createOrchestratorPersona({ clock }),
    director: createDirectorPersona({ clock }),
    configurator: createConfiguratorPersona({ clock }),
    allocator: createAllocatorPersona({ clock }),
    actor: createActorPersona({ clock }),
    moderator: createModeratorPersona({ clock }),
    annotator: createAnnotatorPersona({ clock }),
  };
}

function orderPersonas(personas) {
  const ordered = [];
  const seen = new Set();
  for (const name of DEFAULT_PERSONA_ORDER) {
    if (personas[name]) {
      ordered.push([name, personas[name]]);
      seen.add(name);
    }
  }
  for (const [name, persona] of Object.entries(personas)) {
    if (!seen.has(name)) {
      ordered.push([name, persona]);
    }
  }
  return ordered;
}

function resolveActionParams(action) {
  return action?.params && typeof action.params === "object" ? action.params : {};
}

function resolveActionKind(action) {
  if (!action) return null;
  if (typeof action.kind === "string") return action.kind;
  return null;
}

function resolveActorIdNumeric({ actorId, actorIdMap, core }) {
  if (Number.isFinite(actorId)) return Math.trunc(actorId);
  const numeric = toInt(actorId);
  if (Number.isFinite(numeric)) return numeric;
  if (actorIdMap?.has(actorId)) return actorIdMap.get(actorId);
  if (typeof core?.getActorId === "function") return core.getActorId();
  return 1;
}

function adaptActionToCore({ action, core, actorIdMap, defaultTick }) {
  const kind = resolveActionKind(action);
  const params = resolveActionParams(action);
  const actionTick = Number.isFinite(action?.tick) ? action.tick : defaultTick;

  switch (kind) {
    case "wait":
      return { ok: true, action: { ...action, tick: actionTick }, kind: ACTION_KIND.IncrementCounter, value: 1 };
    case "emit_log": {
      const severity = normalizeLogLevel(params.severity);
      return { ok: true, action: { ...action, tick: actionTick }, kind: ACTION_KIND.EmitLog, value: severity };
    }
    case "emit_telemetry": {
      const metric = toInt(params.metric ?? params.value ?? params.level ?? 0);
      return { ok: true, action: { ...action, tick: actionTick }, kind: ACTION_KIND.EmitTelemetry, value: Math.max(0, metric ?? 0) };
    }
    case "request_external_fact": {
      const detail = toInt(params.detail ?? params.value);
      const value = Number.isFinite(detail) ? Math.max(0, Math.min(255, detail)) : stableHashByte(params.requestId ?? params.query ?? params);
      return { ok: true, action: { ...action, tick: actionTick }, kind: ACTION_KIND.RequestExternalFact, value };
    }
    case "request_solver": {
      const detail = toInt(params.detail ?? params.value);
      const value = Number.isFinite(detail) ? Math.max(0, Math.min(255, detail)) : stableHashByte(params.requestId ?? params.problem ?? params);
      return { ok: true, action: { ...action, tick: actionTick }, kind: ACTION_KIND.RequestSolver, value };
    }
    case "fulfill_request": {
      const seq = parseRequestSequence(params.requestId ?? action.requestId ?? action.id);
      if (!Number.isFinite(seq) || seq <= 0) {
        return { ok: false, reason: "invalid_request_id" };
      }
      return { ok: true, action: { ...action, tick: actionTick }, kind: ACTION_KIND.FulfillRequest, value: seq };
    }
    case "defer_request": {
      const seq = parseRequestSequence(params.requestId ?? action.requestId ?? action.id);
      if (!Number.isFinite(seq) || seq <= 0) {
        return { ok: false, reason: "invalid_request_id" };
      }
      return { ok: true, action: { ...action, tick: actionTick }, kind: ACTION_KIND.DeferRequest, value: seq };
    }
    case "move": {
      const from = params.from;
      const to = params.to;
      const direction = resolveMoveDirection({ direction: params.direction, from, to });
      if (!from || !to || direction === null) {
        return { ok: false, reason: "missing_move_params" };
      }
      const actorNumeric = resolveActorIdNumeric({ actorId: action.actorId, actorIdMap, core });
      const coreTick = typeof core?.getCurrentTick === "function" ? core.getCurrentTick() + 1 : actionTick;
      const packed = packMoveAction({
        actorId: actorNumeric,
        from,
        to,
        direction,
        tick: coreTick,
      });
      return { ok: true, action: { ...action, tick: coreTick }, kind: ACTION_KIND.Move, value: packed };
    }
    default:
      return { ok: false, reason: "unsupported_action_kind" };
  }
}

export function createFsmRuntime({
  core,
  adapters = {},
  effectFactory,
  runId,
  clock,
  personas,
  solverAdapter,
  solverPort,
} = {}) {
  if (!core) {
    throw new Error("Runtime requires a core instance.");
  }

  let tick = 0;
  const effectLog = [];
  const tickFrames = [];
  let activeRunId = typeof runId === "string" && runId.length > 0 ? runId : `run_${Date.now().toString(36)}`;
  let activeClock = typeof clock === "function" ? clock : () => new Date().toISOString();
  let frameCounter = 0;
  let simConfig = null;
  let initialState = null;
  let intentEnvelope = null;
  let planArtifact = null;
  let actorIdMap = new Map();
  let primaryActorId = "actor";
  let baseTiles = null;
  let lastEffects = [];
  let lastFulfilled = [];
  let observationLog = [];
  let orchestrator = null;

  function nextFrameMeta() {
    frameCounter += 1;
    return {
      id: `frame_${frameCounter}`,
      runId: activeRunId,
      createdAt: activeClock(),
      producedBy: "moderator",
    };
  }

  function recordTickFrame({
    phaseDetail,
    emittedEffects = [],
    fulfilledEffects = [],
    acceptedActions = [],
    preCoreRejections = [],
    personaViews = null,
    personaActions = null,
    personaEffects = null,
    personaArtifacts = null,
    telemetry = null,
    solverResults = null,
    solverFulfilled = null,
  } = {}) {
    const frame = {
      schema: "agent-kernel/TickFrame",
      schemaVersion: 1,
      meta: nextFrameMeta(),
      tick,
      phase: "execute",
      phaseDetail,
      acceptedActions,
      emittedEffects,
      fulfilledEffects,
    };
    if (preCoreRejections.length) {
      frame.preCoreRejections = preCoreRejections;
    }
    if (personaViews) frame.personaViews = personaViews;
    if (personaActions) frame.personaActions = personaActions;
    if (personaEffects) frame.personaEffects = personaEffects;
    if (personaArtifacts) frame.personaArtifacts = personaArtifacts;
    if (telemetry) frame.telemetry = telemetry;
    if (solverResults) frame.solverResults = solverResults;
    if (solverFulfilled) frame.solverFulfilled = solverFulfilled;
    tickFrames.push(frame);
  }

  function ensureOrchestrator() {
    const solverPortInstance = solverPort
      || (solverAdapter || adapters?.solver ? createSolverPort({ clock: activeClock }) : null);
    orchestrator = createTickOrchestrator({
      clock: activeClock,
      solverPort: solverPortInstance,
      solverAdapter: solverAdapter || adapters?.solver || null,
    });

    const registry = personas && typeof personas === "object" ? personas : buildDefaultPersonas({ clock: activeClock });
    const ordered = orderPersonas(registry);
    for (const [name, persona] of ordered) {
      orchestrator.registerPersona(name, persona);
    }
  }

  function buildPersonaPayloads({ phase, observation, phaseInputs = {}, actions = [], emittedEffects = [], fulfilledEffects = [] } = {}) {
    const overrides = normalizePersonaPayloadsMap(phaseInputs.personaPayloads || phaseInputs.inputs);
    const actorOverrides = overrides.actor || {};
    const annotatorOverrides = overrides.annotator || {};
    const configuratorOverrides = overrides.configurator || {};
    const directorOverrides = overrides.director || {};
    const allocatorOverrides = overrides.allocator || {};
    const moderatorOverrides = overrides.moderator || {};
    const orchestratorOverrides = overrides.orchestrator || {};

    const planRef = planArtifact
      ? { id: planArtifact.meta?.id, schema: planArtifact.schema, schemaVersion: planArtifact.schemaVersion }
      : simConfig?.planRef ?? null;
    const intentRef = intentEnvelope?.meta
      ? { id: intentEnvelope.meta.id, schema: intentEnvelope.schema, schemaVersion: intentEnvelope.schemaVersion }
      : simConfig?.intentRef ?? null;
    const budgetCaps = simConfig?.constraints?.categoryCaps?.caps;
    const fallbackBudgets = budgetCaps && typeof budgetCaps === "object"
      ? Object.entries(budgetCaps).map(([category, cap]) => ({ category, cap }))
      : [];

    const base = {
      runId: activeRunId,
      tick,
      simConfig,
      initialState,
      effects: lastEffects,
      fulfilledEffects: lastFulfilled,
      intentEnvelope,
      planArtifact,
      planRef,
      intentRef,
    };

    const actorPayload = {
      ...base,
      actorId: primaryActorId,
      observation,
      baseTiles,
      ...actorOverrides,
    };

    const tickObservation = observationLog[observationLog.length - 1] || null;
    const annotatorPayload = {
      ...base,
      runId: activeRunId,
      observations: phase === TickPhases.SUMMARIZE ? observationLog.slice() : tickObservation ? [tickObservation] : [],
      ...annotatorOverrides,
    };

    const configuratorPayload = {
      ...base,
      config: simConfig,
      configRef: simConfig?.meta?.id,
      ...configuratorOverrides,
    };

    const allocatorPayload = { ...base, ...allocatorOverrides };
    if (allocatorPayload.budgets === undefined) allocatorPayload.budgets = fallbackBudgets;
    if (allocatorPayload.budget === undefined && budgetCaps && typeof budgetCaps === "object") {
      allocatorPayload.budget = { ...budgetCaps };
    }
    if (allocatorPayload.signals === undefined) {
      const signalEffects = Array.isArray(emittedEffects) && emittedEffects.length ? emittedEffects : lastEffects;
      const signalFulfilled = Array.isArray(fulfilledEffects) && fulfilledEffects.length ? fulfilledEffects : lastFulfilled;
      const signals = [];
      if (Array.isArray(signalEffects) && signalEffects.length > 0) {
        signals.push({ kind: "effects", count: signalEffects.length, tick });
      }
      if (Array.isArray(signalFulfilled) && signalFulfilled.length > 0) {
        signals.push({ kind: "fulfillments", count: signalFulfilled.length, tick });
      }
      if (actions.length) {
        signals.push({ kind: "actions", count: actions.length, tick });
      }
      allocatorPayload.signals = signals;
    }

    const personaPayloads = {
      actor: actorPayload,
      annotator: annotatorPayload,
      configurator: configuratorPayload,
      director: { ...base, ...directorOverrides },
      allocator: allocatorPayload,
      moderator: { ...base, actions, ...moderatorOverrides },
      orchestrator: { ...base, emittedEffects, fulfilledEffects, ...orchestratorOverrides },
    };

    return personaPayloads;
  }

  function buildPersonaEvents({ phase, phaseInputs = {}, personaPayloads = null } = {}) {
    const overrides = normalizePersonaEventsMap(phaseInputs.personaEvents);
    const events = { ...overrides };
    const personaStates = orchestrator?.view?.().personaStates || {};
    const hasIntent = Boolean(intentEnvelope);
    const hasPlanArtifact = Boolean(planArtifact);
    const planRef = planArtifact
      ? { id: planArtifact.meta?.id, schema: planArtifact.schema, schemaVersion: planArtifact.schemaVersion }
      : simConfig?.planRef ?? null;
    const intentRef = intentEnvelope?.meta
      ? { id: intentEnvelope.meta.id, schema: intentEnvelope.schema, schemaVersion: intentEnvelope.schemaVersion }
      : simConfig?.intentRef ?? null;
    const hasPlan = Boolean(planRef || intentRef);
    const budgetCaps = simConfig?.constraints?.categoryCaps?.caps;
    const hasBudgets = Boolean(budgetCaps && typeof budgetCaps === "object" && Object.keys(budgetCaps).length > 0);
    const allocatorSignals = personaPayloads?.allocator?.signals;
    const hasSignals = Array.isArray(allocatorSignals) && allocatorSignals.length > 0;
    const controlEvent = phaseInputs.controlEvent || phaseInputs.control || phaseInputs.moderatorEvent;

    if (phase === TickPhases.INIT) {
      if (!events.configurator && simConfig) events.configurator = "provide_config";
      if (!events.moderator) {
        const moderatorState = personaStates?.moderator?.state;
        if (moderatorState === "initializing") events.moderator = "start";
      }
    }

    if (phase === TickPhases.OBSERVE) {
      if (!events.actor) events.actor = "observe";
      if (!events.configurator) {
        const cfgState = orchestrator?.view?.().personaStates?.configurator?.state;
        if (cfgState === "pending_config") events.configurator = "validate";
      }
      if (!events.moderator) {
        const moderatorState = personaStates?.moderator?.state;
        if (moderatorState === "initializing") events.moderator = "start";
      }
      if (!events.orchestrator) {
        const orchState = personaStates?.orchestrator?.state;
        if (orchState === "idle" && hasPlanArtifact) events.orchestrator = "plan";
      }
      if (!events.allocator) {
        const allocState = personaStates?.allocator?.state;
        if (allocState === "idle" && hasBudgets) {
          events.allocator = "budget";
        } else if (allocState === "allocating" || allocState === "rebalancing") {
          events.allocator = "monitor";
        }
      }
      if (controlEvent) {
        if (!events.moderator) {
          events.moderator = controlEvent;
        } else {
          const sequence = Array.isArray(events.moderator) ? events.moderator : [events.moderator];
          if (!sequence.includes(controlEvent)) {
            events.moderator = [...sequence, controlEvent];
          }
        }
      }
    }

    if (phase === TickPhases.DECIDE) {
      if (!events.actor) events.actor = ["decide", "propose"];
      if (!events.orchestrator) {
        const orchState = personaStates?.orchestrator?.state;
        if (orchState === "planning" && hasPlanArtifact) events.orchestrator = "start_run";
      }
      if (!events.director) {
        const directorState = personaStates?.director?.state;
        if (hasIntent || hasPlanArtifact) {
          if (directorState === "uninitialized") {
            events.director = "bootstrap";
          } else if (directorState === "intake") {
            events.director = hasPlanArtifact ? "ingest_plan" : "ingest_intent";
          } else if (directorState === "draft_plan" && planRef) {
            events.director = "draft_complete";
          } else if (directorState === "refine" && planRef) {
            events.director = "refinement_complete";
          } else if (directorState === "stale") {
            events.director = "refresh";
          }
        }
      }
      if (!events.allocator) {
        const allocState = personaStates?.allocator?.state;
        if (allocState === "budgeting" && hasBudgets) {
          events.allocator = "allocate";
        } else if (allocState === "monitoring" && hasSignals) {
          events.allocator = "rebalance";
        }
      }
    }

    if (phase === TickPhases.EMIT) {
      if (!events.annotator) {
        const annotatorState = orchestrator?.view?.().personaStates?.annotator?.state;
        events.annotator = annotatorState === "summarizing"
          ? ["reset", "observe"]
          : "observe";
      }
    }

    if (phase === TickPhases.SUMMARIZE) {
      if (!events.annotator) events.annotator = "summarize";
      if (!events.configurator) {
        const cfgState = orchestrator?.view?.().personaStates?.configurator?.state;
        if (cfgState === "configured") events.configurator = "lock";
      }
    }

    return events;
  }

  function applyPersonaArtifacts(record) {
    const planFromRecord = findPlanArtifact(record?.artifacts);
    if (planFromRecord) {
      planArtifact = planFromRecord;
    }
  }

  function applyActionsToCore(actions) {
    const acceptedActions = [];
    const preCoreRejections = [];
    const defaultTick = tick;

    for (const action of actions) {
      const adaptation = adaptActionToCore({ action, core, actorIdMap, defaultTick });
      if (!adaptation.ok) {
        preCoreRejections.push({ action, reason: adaptation.reason || "invalid_action" });
        continue;
      }
      if (adaptation.kind === ACTION_KIND.Move) {
        if (typeof core?.setMoveAction !== "function" || typeof core?.applyAction !== "function") {
          preCoreRejections.push({ action, reason: "missing_move_exports" });
          continue;
        }
        try {
          applyMoveAction(core, adaptation.value);
        } catch (err) {
          preCoreRejections.push({ action, reason: err?.message || "move_failed" });
          continue;
        }
      } else if (typeof core?.applyAction === "function") {
        core.applyAction(adaptation.kind, adaptation.value);
      } else if (typeof core?.step === "function") {
        core.step();
      } else {
        preCoreRejections.push({ action, reason: "missing_core_applyAction" });
        continue;
      }
      acceptedActions.push(adaptation.action);
    }

    return { acceptedActions, preCoreRejections };
  }

  return {
    async init(seedOrOptions = 0) {
      const options = typeof seedOrOptions === "object" && seedOrOptions !== null
        ? seedOrOptions
        : { seed: seedOrOptions };
      if (typeof options.runId === "string" && options.runId.length > 0) {
        activeRunId = options.runId;
      }
      if (typeof options.clock === "function") {
        activeClock = options.clock;
      }
      const seed = Number.isFinite(options.seed) ? options.seed : 0;
      tick = 0;
      effectLog.length = 0;
      tickFrames.length = 0;
      observationLog.length = 0;
      frameCounter = 0;
      simConfig = options.simConfig || null;
      initialState = options.initialState || null;
      intentEnvelope = options.intentEnvelope || options.intent || null;
      planArtifact = options.planArtifact || options.plan || null;
      const mapping = buildActorIdMap(initialState);
      actorIdMap = mapping.map;
      primaryActorId = mapping.primaryActorId;
      baseTiles = null;

      core.init(seed);
      if (simConfig?.layout) {
        const layoutResult = applySimConfigToCore(core, simConfig);
        if (!layoutResult.ok) {
          throw new Error(`Failed to apply sim config layout: ${layoutResult.reason || "unknown"}`);
        }
        if (initialState) {
          const actorResult = applyInitialStateToCore(core, initialState, { spawn: layoutResult.spawn });
          if (!actorResult.ok) {
            throw new Error(`Failed to apply initial state: ${actorResult.reason || "unknown"}`);
          }
        }
      } else if (initialState) {
        const actorResult = applyInitialStateToCore(core, initialState);
        if (!actorResult.ok) {
          throw new Error(`Failed to apply initial state: ${actorResult.reason || "unknown"}`);
        }
      }

      baseTiles = resolveBaseTiles(simConfig, core);
      applyBudgetCaps(core, simConfig);

      ensureOrchestrator();

      const frameEffects = flushEffects({ core, adapters, effectFactory, tick, effectLog });
      lastEffects = frameEffects.emittedEffects;
      lastFulfilled = frameEffects.fulfilledEffects;

      const initPersonaPayloads = buildPersonaPayloads({ phase: TickPhases.INIT, phaseInputs: options });
      const initPayload = {
        personaEvents: buildPersonaEvents({ phase: TickPhases.INIT, phaseInputs: options, personaPayloads: initPersonaPayloads }),
        personaPayloads: initPersonaPayloads,
      };
      const initRecord = await orchestrator.dispatchPhase({
        phase: TickPhases.INIT,
        event: "init",
        payload: initPayload,
      });

      applyPersonaArtifacts(initRecord);
      recordTickFrame({
        phaseDetail: "init",
        emittedEffects: frameEffects.emittedEffects,
        fulfilledEffects: frameEffects.fulfilledEffects,
        personaViews: initRecord.personaViews,
        personaActions: initRecord.actions,
        personaEffects: initRecord.effects,
        personaArtifacts: initRecord.artifacts,
        telemetry: initRecord.telemetry,
        solverResults: initRecord.solverResults,
        solverFulfilled: initRecord.solverFulfilled,
      });
    },

    async step(stepOptions = {}) {
      if (!orchestrator) {
        ensureOrchestrator();
      }

      const currentPhase = orchestrator.view().phase;
      const observation = resolveObservation(core, primaryActorId);
      const observePersonaPayloads = buildPersonaPayloads({
        phase: TickPhases.OBSERVE,
        observation,
        phaseInputs: stepOptions,
      });
      const observeInputs = {
        personaEvents: buildPersonaEvents({
          phase: TickPhases.OBSERVE,
          phaseInputs: stepOptions,
          personaPayloads: observePersonaPayloads,
        }),
        personaPayloads: observePersonaPayloads,
      };

      let observeRecord;
      if (currentPhase === TickPhases.INIT) {
        observeRecord = await orchestrator.stepPhase("observe", observeInputs);
      } else if (currentPhase === TickPhases.SUMMARIZE) {
        observeRecord = await orchestrator.stepPhase("next_tick", observeInputs);
      } else if (currentPhase === TickPhases.OBSERVE) {
        observeRecord = await orchestrator.dispatchPhase({ phase: TickPhases.OBSERVE, event: "observe", payload: observeInputs });
      } else {
        observeRecord = await orchestrator.dispatchPhase({ phase: currentPhase, event: "observe", payload: observeInputs });
      }

      applyPersonaArtifacts(observeRecord);
      tick = observeRecord.tick + 1;
      recordTickFrame({
        phaseDetail: TickPhases.OBSERVE,
        personaViews: observeRecord.personaViews,
        personaActions: observeRecord.actions,
        personaEffects: observeRecord.effects,
        personaArtifacts: observeRecord.artifacts,
        telemetry: observeRecord.telemetry,
        solverResults: observeRecord.solverResults,
        solverFulfilled: observeRecord.solverFulfilled,
      });

      const decidePersonaPayloads = buildPersonaPayloads({
        phase: TickPhases.DECIDE,
        observation,
        phaseInputs: stepOptions,
      });
      const decideInputs = {
        personaTick: tick,
        personaEvents: buildPersonaEvents({
          phase: TickPhases.DECIDE,
          phaseInputs: stepOptions,
          personaPayloads: decidePersonaPayloads,
        }),
        personaPayloads: decidePersonaPayloads,
      };
      const decideRecord = await orchestrator.stepPhase("decide", decideInputs);
      const actorState = decideRecord.personaViews?.actor?.state;
      if (actorState === "proposing" || actorState === "deciding") {
        const cooldownRecord = await orchestrator.dispatchPhase({
          phase: TickPhases.DECIDE,
          event: "cooldown",
          payload: {
            personaTick: tick,
            personaEvents: { actor: "cooldown" },
            personaPayloads: decideInputs.personaPayloads,
          },
        });
        decideRecord.personaViews = cooldownRecord.personaViews;
      }
      const actions = Array.isArray(decideRecord.actions) ? decideRecord.actions : [];

      applyPersonaArtifacts(decideRecord);
      recordTickFrame({
        phaseDetail: TickPhases.DECIDE,
        personaViews: decideRecord.personaViews,
        personaActions: decideRecord.actions,
        personaEffects: decideRecord.effects,
        personaArtifacts: decideRecord.artifacts,
        telemetry: decideRecord.telemetry,
        solverResults: decideRecord.solverResults,
        solverFulfilled: decideRecord.solverFulfilled,
      });

      const applyPersonaPayloads = buildPersonaPayloads({
        phase: TickPhases.APPLY,
        observation,
        phaseInputs: stepOptions,
        actions,
      });
      const applyInputs = {
        personaTick: tick,
        personaEvents: buildPersonaEvents({
          phase: TickPhases.APPLY,
          phaseInputs: stepOptions,
          personaPayloads: applyPersonaPayloads,
        }),
        personaPayloads: applyPersonaPayloads,
      };
      const applyRecord = await orchestrator.stepPhase("apply", applyInputs);
      const applied = applyActionsToCore(actions);

      applyPersonaArtifacts(applyRecord);
      recordTickFrame({
        phaseDetail: TickPhases.APPLY,
        acceptedActions: applied.acceptedActions,
        preCoreRejections: applied.preCoreRejections,
        personaViews: applyRecord.personaViews,
        personaActions: applyRecord.actions,
        personaEffects: applyRecord.effects,
        personaArtifacts: applyRecord.artifacts,
        telemetry: applyRecord.telemetry,
        solverResults: applyRecord.solverResults,
        solverFulfilled: applyRecord.solverFulfilled,
      });

      const frameEffects = flushEffects({ core, adapters, effectFactory, tick, effectLog });
      lastEffects = frameEffects.emittedEffects;
      lastFulfilled = frameEffects.fulfilledEffects;
      observationLog.push({ tick, effects: lastEffects, fulfilledEffects: lastFulfilled, persona: "core" });

      const emitPersonaPayloads = buildPersonaPayloads({
        phase: TickPhases.EMIT,
        observation,
        phaseInputs: stepOptions,
        emittedEffects: lastEffects,
        fulfilledEffects: lastFulfilled,
      });
      const emitInputs = {
        personaTick: tick,
        personaEvents: buildPersonaEvents({
          phase: TickPhases.EMIT,
          phaseInputs: stepOptions,
          personaPayloads: emitPersonaPayloads,
        }),
        personaPayloads: emitPersonaPayloads,
      };
      const emitRecord = await orchestrator.stepPhase("emit", emitInputs);

      applyPersonaArtifacts(emitRecord);
      recordTickFrame({
        phaseDetail: TickPhases.EMIT,
        emittedEffects: frameEffects.emittedEffects,
        fulfilledEffects: frameEffects.fulfilledEffects,
        personaViews: emitRecord.personaViews,
        personaActions: emitRecord.actions,
        personaEffects: emitRecord.effects,
        personaArtifacts: emitRecord.artifacts,
        telemetry: emitRecord.telemetry,
        solverResults: emitRecord.solverResults,
        solverFulfilled: emitRecord.solverFulfilled,
      });

      const summarizePersonaPayloads = buildPersonaPayloads({
        phase: TickPhases.SUMMARIZE,
        observation,
        phaseInputs: stepOptions,
      });
      const summarizeInputs = {
        personaTick: tick,
        personaEvents: buildPersonaEvents({
          phase: TickPhases.SUMMARIZE,
          phaseInputs: stepOptions,
          personaPayloads: summarizePersonaPayloads,
        }),
        personaPayloads: summarizePersonaPayloads,
      };
      const summarizeRecord = await orchestrator.stepPhase("summarize", summarizeInputs);

      applyPersonaArtifacts(summarizeRecord);
      recordTickFrame({
        phaseDetail: TickPhases.SUMMARIZE,
        personaViews: summarizeRecord.personaViews,
        personaActions: summarizeRecord.actions,
        personaEffects: summarizeRecord.effects,
        personaArtifacts: summarizeRecord.artifacts,
        telemetry: summarizeRecord.telemetry,
        solverResults: summarizeRecord.solverResults,
        solverFulfilled: summarizeRecord.solverFulfilled,
      });

      return core.getCounter ? core.getCounter() : null;
    },

    getState() {
      return { counter: core.getCounter ? core.getCounter() : 0 };
    },

    getEffectLog() {
      return effectLog.slice();
    },

    getTickFrames() {
      return tickFrames.slice();
    },
  };
}
