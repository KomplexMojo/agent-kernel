import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { applyBudgetCaps, applyActionBudgetCosts, readBudgetLedger } from "../ports/budget.js";
import * as effects from "../ports/effects.js";
import { createSolverPort } from "../ports/solver.js";
import { createTickOrchestrator } from "../personas/_shared/tick-orchestrator.mts";
import { TickPhases } from "../personas/_shared/tick-state-machine.mts";
import { createActorPersona } from "../personas/actor/persona.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createAnnotatorPersona } from "../personas/annotator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createDirectorPersona } from "../personas/director/persona.js";
import { createModeratorPersona, FulfillmentDispositions } from "../personas/moderator/persona.js";
import { createOrchestratorPersona, collectDeferredEffects } from "../personas/orchestrator/persona.js";
import { applyInitialStateToCore, applySimConfigToCore } from "./core-setup.mjs";
import {
  applyMoveAction,
  getValidationErrorName,
  packMoveAction,
  readObservation,
  renderBaseTiles,
  ValidationError,
} from "../../../core-ts/src/index.ts";
import { AFFINITY_EXPRESSIONS, AFFINITY_KINDS, AFFINITY_OPPOSITES } from "../contracts/domain-constants.js";
import { computeAuraMap, serializeAuraMap } from "../render/affinity-aura.js";
import { SPATIAL_WEIGHTS, INTERACTION_MATRIX } from "../contracts/affinity-spatial-rules.js";
import {
  EFFECT_SCHEMA,
  PLAN_ARTIFACT_SCHEMA,
  TICK_FRAME_SCHEMA,
} from "../contracts/artifacts.ts";

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
const TILE_CODES = Object.freeze({
  floor: 1,
  barrier: 4,
});
const AFFINITY_KIND_CODES = Object.freeze(
  AFFINITY_KINDS.reduce((acc, kind, index) => {
    acc[kind] = index + 1;
    return acc;
  }, {}),
);
const AFFINITY_EXPRESSION_CODES = Object.freeze(
  AFFINITY_EXPRESSIONS.reduce((acc, expression, index) => {
    acc[expression] = index + 1;
    return acc;
  }, {}),
);

// CR.5 — the persona execution order used to be declared here, as a private
// DEFAULT_PERSONA_ORDER constant. It is now Moderator policy
// (personas/moderator/tick-ordering.js) and the runner asks for it; see
// ensureOrchestrator().

const DEFAULT_LOG_LEVELS = Object.freeze({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
});


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
  if (dx === 1 && dy === -1) return "northeast";
  if (dx === 1 && dy === 0) return "east";
  if (dx === 1 && dy === 1) return "southeast";
  if (dx === -1 && dy === 1) return "southwest";
  if (dx === -1 && dy === 0) return "west";
  if (dx === -1 && dy === -1) return "northwest";
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

function resolveObservation(core, actorIdLabel, baseTiles, affinityEffects, layoutHazards = [], actorIds = []) {
  if (!core || !canReadObservation(core)) return null;
  try {
    const observation = readObservation(core, { actorIdLabel, affinityEffects, actorIds });

    // Enrich observation hazards with full vitals from layout
    if (observation && Array.isArray(observation.hazards) && Array.isArray(layoutHazards)) {
      const hazardVitalsByPosition = new Map();
      layoutHazards.forEach((layoutHazard) => {
        if (layoutHazard?.position?.x != null && layoutHazard?.position?.y != null) {
          const key = `${layoutHazard.position.x},${layoutHazard.position.y}`;
          hazardVitalsByPosition.set(key, layoutHazard.vitals);
        } else if (layoutHazard?.x != null && layoutHazard?.y != null) {
          const key = `${layoutHazard.x},${layoutHazard.y}`;
          hazardVitalsByPosition.set(key, layoutHazard.vitals);
        }
      });

      observation.hazards = observation.hazards.map((hazard) => {
        const key = `${hazard.position?.x ?? 0},${hazard.position?.y ?? 0}`;
        const vitals = hazardVitalsByPosition.get(key);
        return vitals ? { ...hazard, vitals } : hazard;
      });
    }

    // Compatibility only: existing renderers/tests still consume observation.auras.
    // New tile visuals should come from core affinity field records.
    if (observation && baseTiles && (Array.isArray(observation.actors) || Array.isArray(observation.hazards))) {
      const actors = Array.isArray(observation.actors) ? observation.actors : [];
      const hazards = Array.isArray(observation.hazards) ? observation.hazards : [];

      // Convert hazards to pseudo-actors for the compatibility aura projection.
      const hazardActors = hazards.map((hazard, index) => ({
        id: `hazard_${index}`,
        x: hazard.position?.x ?? 0,
        y: hazard.position?.y ?? 0,
        affinities: hazard.affinities || [],
      }));

      const allActors = [...actors, ...hazardActors];
      const auraMap = computeAuraMap(allActors, baseTiles, {
        affinityOpposites: AFFINITY_OPPOSITES,
        weights: SPATIAL_WEIGHTS,
      });
      observation.auras = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);
    }

    return observation;
  } catch {
    return null;
  }
}

function buildEffectRecordFactory({ core, effectFactory, tick }) {
  const buildEffectFromCore = typeof effects.buildEffectFromCore === "function"
    ? effects.buildEffectFromCore
    : () => {
        throw new Error("Missing core effect mapper");
      };

  return ({ kind, value, index }) => {
    const coreEffect = {
      tick,
      index,
      kind,
      value,
      actorId: typeof core?.getEffectActorId === "function" ? core.getEffectActorId(index) : undefined,
      x: typeof core?.getEffectX === "function" ? core.getEffectX(index) : undefined,
      y: typeof core?.getEffectY === "function" ? core.getEffectY(index) : undefined,
      reason: typeof core?.getEffectReason === "function" ? core.getEffectReason(index) : undefined,
      delta: typeof core?.getEffectDelta === "function" ? core.getEffectDelta(index) : undefined,
    };

    // effectFactory is the explicit extension seam for caller-defined custom
    // kinds. It is resolved before the closed core codebook so injected kinds
    // remain supported while unknown core kinds fail loud.
    if (typeof effectFactory === "function") {
      const customEffect = effectFactory(coreEffect);
      if (customEffect) {
        const base = {
          schema: EFFECT_SCHEMA,
          schemaVersion: 1,
          id: `eff_${tick}_${index}_${kind}_${value}`,
          tick,
          fulfillment: "deterministic",
          personaRef: "core",
          tags: ["core"],
        };
        return { ...base, ...customEffect, id: customEffect.id || base.id };
      }
    }
    return buildEffectFromCore(coreEffect);
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

// CR.5 — the runner reads core, then EXECUTES the Moderator's fulfilment plan. It
// no longer decides dispositions: which effects are satisfied deterministically,
// which defer and which are dispatched is Moderator policy
// (personas/moderator/effect-fulfillment.js), as is the emission order. Actual
// dispatch stays here, behind ports/effects.js — the persona decides, glue does IO.
function flushEffects({ core, adapters, effectFactory, tick, effectLog, moderator }) {
  const count = core.getEffectCount();
  const buildEffectRecord = buildEffectRecordFactory({ core, effectFactory, tick });
  const built = [];
  for (let i = 0; i < count; i += 1) {
    const kind = core.getEffectKind(i);
    const value = core.getEffectValue(i);
    const effect = buildEffectRecord({ kind, value, index: i });
    normalizeEffectKind(effect);
    built.push({ effect, coreKind: kind, coreValue: value });
  }

  const plan = moderator.advance({
    phase: TickPhases.EMIT,
    event: "plan_effect_fulfillment",
    payload: { effects: built.map((entry) => entry.effect) },
    tick,
  })?.fulfillmentPlan;
  if (!Array.isArray(plan)) {
    throw new Error(
      "Moderator did not return a fulfilment plan: effect fulfilment is Moderator policy (CR.5), "
      + "so the runner has no disposition of its own to fall back on.",
    );
  }

  const records = [];
  for (const decision of plan) {
    const { effect, coreKind, coreValue } = built[decision.index];
    if (decision.fulfillment) {
      effect.fulfillment = decision.fulfillment;
    }
    let outcome;
    if (decision.disposition === FulfillmentDispositions.DISPATCH) {
      const dispatch = typeof effects.dispatchEffect === "function"
        ? effects.dispatchEffect
        : () => ({ status: "deferred", reason: "missing_dispatchEffect" });
      outcome = dispatch(adapters, effect);
    } else {
      outcome = { status: decision.status, result: decision.result, reason: decision.reason };
    }
    records.push({
      effect,
      outcome,
      index: decision.index,
      coreKind,
      coreValue,
    });
  }
  // Kept AFTER dispatch, exactly where it sat pre-CR.5: clearing earlier would
  // change which effects survive should a dispatch ever write back to core.
  core.clearEffects();

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
  // CR.6 — the Actor is handed the Allocator's own admissibility judge rather than
  // carrying a copy of the policy. Built first so the wiring is explicit: budget
  // admissibility has one definition, in the persona that owns the economy, and
  // the Actor cannot reach a verdict the Allocator would not.
  const allocator = createAllocatorPersona({ clock });
  return {
    orchestrator: createOrchestratorPersona({ clock }),
    director: createDirectorPersona({ clock }),
    configurator: createConfiguratorPersona({ clock }),
    allocator,
    actor: createActorPersona({ clock, admitProposals: allocator.admitProposals }),
    moderator: createModeratorPersona({ clock }),
    annotator: createAnnotatorPersona({ clock }),
  };
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
    case "attack": {
      // M5: simple motivation combat dispatch.
      // Resolves attacker/defender by actor ID, passes to core.applyAttack via direct directive.
      const targetId = params.targetId;
      if (!targetId) {
        return { ok: false, reason: "missing_target_id" };
      }
      const attackerNumeric = resolveActorIdNumeric({ actorId: action.actorId, actorIdMap, core });
      const defenderNumeric = resolveActorIdNumeric({ actorId: targetId, actorIdMap, core });
      const damage = typeof params.damage === "number" && params.damage > 0 ? params.damage : 2;
      return {
        ok: true,
        action: { ...action, tick: actionTick },
        direct: {
          kind: "apply_attack",
          attackerNumeric,
          defenderNumeric,
          damage,
          targetId,
        },
      };
    }
    case "destroy_barrier": {
      const x = toInt(params.x);
      const y = toInt(params.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, reason: "missing_target_position" };
      }
      if (typeof core?.destroyBarrierAt !== "function" && typeof core?.setTileAt !== "function") {
        return { ok: false, reason: "missing_destroyBarrierAt" };
      }
      return {
        ok: true,
        action: { ...action, tick: actionTick },
        direct: { kind: "destroy_barrier", x, y },
      };
    }
    case "raise_barrier": {
      const x = toInt(params.x);
      const y = toInt(params.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, reason: "missing_target_position" };
      }
      if (typeof core?.raiseBarrierAt !== "function" && typeof core?.setTileAt !== "function") {
        return { ok: false, reason: "missing_raiseBarrierAt" };
      }
      return {
        ok: true,
        action: { ...action, tick: actionTick },
        direct: { kind: "raise_barrier", x, y },
      };
    }
    case "arm_static_hazard": {
      const x = toInt(params.x);
      const y = toInt(params.y);
      const kind = typeof params.kind === "string" ? params.kind.toLowerCase() : "";
      const expression = typeof params.expression === "string" ? params.expression.toLowerCase() : "";
      const affinityKind = AFFINITY_KIND_CODES[kind];
      const affinityExpression = AFFINITY_EXPRESSION_CODES[expression];
      const stacks = toInt(params.stacks);
      const manaReserve = toInt(params.manaReserve ?? params.mana);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, reason: "missing_target_position" };
      }
      if (!Number.isFinite(affinityKind) || !Number.isFinite(affinityExpression)) {
        return { ok: false, reason: "invalid_affinity_hazard_spec" };
      }
      if (!Number.isFinite(stacks) || stacks <= 0 || !Number.isFinite(manaReserve) || manaReserve <= 0) {
        return { ok: false, reason: "invalid_static_hazard_costs" };
      }
      if (typeof core?.armStaticHazardAt !== "function") {
        return { ok: false, reason: "missing_armStaticHazardAt" };
      }
      return {
        ok: true,
        action: { ...action, tick: actionTick },
        direct: {
          kind: "arm_static_hazard",
          x,
          y,
          affinityKind,
          affinityExpression,
          stacks,
          manaReserve,
        },
      };
    }
    case "disarm_static_hazard": {
      const x = toInt(params.x);
      const y = toInt(params.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, reason: "missing_target_position" };
      }
      if (typeof core?.disarmStaticHazardAt !== "function") {
        return { ok: false, reason: "missing_disarmStaticHazardAt" };
      }
      return {
        ok: true,
        action: { ...action, tick: actionTick },
        direct: { kind: "disarm_static_hazard", x, y },
      };
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
  let moderator = null;
  let annotator = null;
  // P5.5 — the Orchestrator PERSONA from the registry, not the tick orchestrator that
  // shares its name in this file. Post-run deferred-effect coordination is its work.
  let orchestratorPersona = null;
  const effectLog = [];
  const tickFrames = [];
  // PX.3 extended to the runner. `activeClock` defaulted to
  // `() => new Date().toISOString()` and the fallback run id came from
  // `Date.now()` — the exact defaulted-clock pattern PX.3 removed from every
  // persona, still live in the file that drives them. A defaulted clock does not
  // fail, it degrades determinism and replay quietly, which is why it survived.
  //
  // UNUSED_CLOCK is the repo's existing marker for "a clock is structurally
  // required here but no round is being timed": it is a fixed epoch, so a
  // caller that forgets to inject gets a reproducible run rather than one
  // stamped with wall-clock time. The fallback run id is derived from it.
  let activeClock = typeof clock === "function" ? clock : UNUSED_CLOCK;
  let activeRunId = typeof runId === "string" && runId.length > 0
    ? runId
    : `run_${activeClock().replace(/[^0-9]/g, "")}`;
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
  // P5.5 — applyBudgetCaps's own return value: the categories a cap was actually
  // issued for. The Allocator's reconciliation reads spend against exactly these.
  let appliedBudgetCaps = [];
  let observationLog = [];
  let affinityEffects = null;
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
      schema: TICK_FRAME_SCHEMA,
      schemaVersion: 1,
      meta: nextFrameMeta(),
      tick,
      phase: "execute",
      phaseDetail,
      acceptedActions,
      emittedEffects,
      fulfilledEffects,
      events: [],
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
      llmAdapter: adapters?.llm || adapters?.ollama || null,
    });

    const registry = personas && typeof personas === "object"
      ? { ...personas }
      : buildDefaultPersonas({ clock: activeClock });
    // CR.5 — the Moderator controls the tick, so a runtime that runs ticks has one.
    // buildDefaultPersonas always provides it; a caller-supplied registry that omits
    // it still gets one, which is what keeps ordering and fulfilment policy to a
    // single origin instead of needing a runner-side fallback copy.
    if (!registry.moderator) {
      registry.moderator = createModeratorPersona({ clock: activeClock });
    }
    moderator = registry.moderator;
    annotator = registry.annotator ?? null;
    orchestratorPersona = registry.orchestrator ?? null;

    const order = moderator.advance({
      phase: TickPhases.INIT,
      event: "plan_persona_order",
      payload: { personaNames: Object.keys(registry) },
      tick,
    })?.personaOrder;
    if (!Array.isArray(order)) {
      throw new Error(
        "Moderator did not return a persona order: tick ordering is Moderator policy (CR.5), "
        + "so a registry whose `moderator` cannot answer plan_persona_order cannot run a tick.",
      );
    }
    for (const name of order) {
      orchestrator.registerPersona(name, registry[name]);
    }
  }

  function buildPersonaPayloads({ phase, observation, phaseInputs = {}, actions = [], emittedEffects = [], fulfilledEffects = [], actorId, reservedTargets } = {}) {
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
      affinityEffects,
      effects: lastEffects,
      fulfilledEffects: lastFulfilled,
      intentEnvelope,
      planArtifact,
      planRef,
      intentRef,
    };

    const actorPayload = {
      ...base,
      actorId: actorId || primaryActorId,
      observation,
      baseTiles,
      ...(Array.isArray(reservedTargets) && reservedTargets.length > 0 ? { reservedTargets } : {}),
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
    // P5.5 — the reconciliation input. `signals` are COUNTS of effects, fulfilments
    // and actions: they say something happened, never what it cost. The ledger is
    // the issued-versus-actual pair the charter's reconciliation is actually about,
    // and it is read here (glue reads core) so the persona only ever decides.
    if (allocatorPayload.ledger === undefined) {
      const ledger = readBudgetLedger(core, appliedBudgetCaps);
      if (ledger) allocatorPayload.ledger = ledger;
    }

    const personaPayloads = {
      actor: actorPayload,
      annotator: annotatorPayload,
      configurator: configuratorPayload,
      director: { ...base, ...directorOverrides },
      allocator: allocatorPayload,
      moderator: { ...base, actions, observation, ...moderatorOverrides },
      orchestrator: { ...base, emittedEffects, fulfilledEffects, ...orchestratorOverrides },
    };

    return personaPayloads;
  }

  function buildPersonaEvents({ phase, phaseInputs = {}, personaPayloads = null } = {}) {
    const overrides = normalizePersonaEventsMap(phaseInputs.personaEvents);
    const events = { ...overrides };
    const personaStates = orchestrator?.view?.().personaStates || {};
    const hasIntent = Boolean(intentEnvelope);
    // PX.5 — "a plan exists" now also counts the SimConfig's planRef, which is the
    // CORRECT source during a run: the plan was produced on the build plane and the
    // SimConfig names it. Previously this was true only once the Director had minted
    // a plan mid-tick, so the Orchestrator's progression depended on build-plane work
    // happening inside the run loop.
    const hasPlanArtifact = Boolean(planArtifact || simConfig?.planRef);
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

    // PX.5 / Option A — the tick plane does NOT drive the Configurator's build round.
    //
    // It used to inject `provide_config` here, then `validate` in OBSERVE and `lock`
    // in SUMMARIZE, walking the FSM uninitialized -> pending_config -> configured ->
    // locked on every run. That walk was ceremony: the only reader of the resulting
    // state was the code choosing the next event to send, and none of it performed
    // the work the states claim — the service surface (provideConfig/validate/lock)
    // was never called, so a run reached `locked` with hasConfig false and no
    // published snapshot.
    //
    // Configuration assembly, validation and locking are BUILD-plane concerns
    // (charter rule 3, "build plane ≠ tick plane"): the tick plane consumes an
    // already-built SimConfig, it does not author one. The clinching detail is that
    // the two planes do not even pass the same TYPE — the build plane's `config` is
    // `spec.configurator.inputs`, the tick plane's was the SimConfigArtifact — so
    // routing these events through the service methods would have validated nothing
    // while appearing to (see tests/personas/dual-surface-shadowing.test.js).
    //
    // The CAPABILITY is retained, only the automatic ceremony is gone: `events` is
    // seeded from `phaseInputs.personaEvents`, so a caller that genuinely wants to
    // drive the Configurator on the tick plane still can, and subscribePhases is
    // deliberately left intact so that path keeps working.
    if (phase === TickPhases.INIT) {
      if (!events.moderator) {
        const moderatorState = personaStates?.moderator?.state;
        if (moderatorState === "initializing") events.moderator = "start";
      }
    }

    if (phase === TickPhases.OBSERVE) {
      if (!events.actor) events.actor = "observe";
      if (!events.moderator) {
        const moderatorState = personaStates?.moderator?.state;
        if (moderatorState === "initializing") events.moderator = "start";
      }
      if (!events.orchestrator) {
        const orchState = personaStates?.orchestrator?.state;
        if (orchState === "idle" && hasPlanArtifact) events.orchestrator = "plan";
      }
      // PX.5 — the tick plane drives the Allocator's OWN loop (monitor/rebalance),
      // never the build-plane budget vocabulary. `budget`/`allocate` are sent by
      // allocator-services.js (registerBudget/validateSpend); sending them from here
      // made a run report `allocating` with budgetTokens null and receiptCount 0 —
      // a state claiming a budget round that never happened. `monitor` can now be
      // entered from idle, so the runtime loop no longer has to pass through that
      // claim to get going. `observe` is a state-preserving round for the phases
      // where nothing should move: the Allocator's tick work is payload-driven, so
      // it still emits its request actions.
      if (!events.allocator) {
        const allocState = personaStates?.allocator?.state;
        events.allocator = allocState === "idle" || allocState === "rebalancing" ? "monitor" : "observe";
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
      // PX.5 — the tick plane walks the Director's build round ONLY when there is no
      // plan to consume.
      //
      // bootstrap/ingest_intent/draft_complete/refinement_complete are
      // director-services.js's events (beginBuild, assembleBuildSpec), so sending
      // them asserts a build round. In the normal run — a SimConfig that already
      // names its plan via planRef — that assertion was false: the Director reported
      // `ready` with buildSpecCount 0 and planId null while minting a PlanArtifact
      // mid-run, which is build-plane work inside a loop whose plan already exists.
      //
      // But a runtime CAN legitimately be started from a bare IntentEnvelope with no
      // SimConfig (runtime-plan-artifact.test.js does exactly that), and then the
      // Director drafting a plan in-loop is the feature, not the defect. So the walk
      // is preserved for that case only, and every run that has a plan gets the
      // state-preserving `observe`.
      if (!events.director) {
        const directorState = personaStates?.director?.state;
        const hasPlanToConsume = Boolean(planArtifact || simConfig?.planRef);
        if (!hasPlanToConsume && hasIntent) {
          if (directorState === "uninitialized") {
            events.director = "bootstrap";
          } else if (directorState === "intake") {
            events.director = "ingest_intent";
          } else if (directorState === "draft_plan" && planRef) {
            events.director = "draft_complete";
          } else if (directorState === "refine" && planRef) {
            events.director = "refinement_complete";
          } else if (directorState === "stale") {
            events.director = "refresh";
          } else {
            events.director = "observe";
          }
        } else {
          events.director = "observe";
        }
      }
      // PX.5 — rebalance is signal-driven and tick-native; `allocate` is not sent
      // here any more (it is validateSpend's event, a claim this plane cannot make).
      //
      // P5.5 — and it now also requires a LEDGER, because `rebalance` stopped being a
      // label the day REBALANCING started gating reconciliation. The persona refuses to
      // reconcile without one, so sending the event with nothing to reconcile would
      // throw mid-tick. A run whose core exposes no usage counter therefore stays in
      // `monitoring`: the honest state, since no reconciliation happened. That is the
      // charter's rule applied to the trigger as well as to the state — an event that
      // announces work must only be sent when the work can be done.
      if (!events.allocator) {
        const allocState = personaStates?.allocator?.state;
        const canReconcile = hasSignals && Boolean(personaPayloads?.allocator?.ledger);
        events.allocator = allocState === "monitoring" && canReconcile ? "rebalance" : "observe";
      }
    }

    if (phase === TickPhases.APPLY) {
      if (!events.moderator) {
        const hasAffinityEffects = Boolean(personaPayloads?.moderator?.affinityEffects);
        if (hasAffinityEffects) {
          events.moderator = "resolve_affinity";
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
      if (adaptation.direct) {
        const directive = adaptation.direct;
        if (directive.kind === "destroy_barrier") {
          const applied = typeof core.destroyBarrierAt === "function"
            ? core.destroyBarrierAt(directive.x, directive.y)
            : (core.setTileAt(directive.x, directive.y, TILE_CODES.floor), 1);
          if (Number.isFinite(applied) && applied === 0) {
            preCoreRejections.push({ action, reason: "destroy_barrier_rejected" });
            continue;
          }
          acceptedActions.push(adaptation.action);
          continue;
        }
        if (directive.kind === "raise_barrier") {
          const applied = typeof core.raiseBarrierAt === "function"
            ? core.raiseBarrierAt(directive.x, directive.y)
            : (core.setTileAt(directive.x, directive.y, TILE_CODES.barrier), 1);
          if (Number.isFinite(applied) && applied === 0) {
            preCoreRejections.push({ action, reason: "raise_barrier_rejected" });
            continue;
          }
          acceptedActions.push(adaptation.action);
          continue;
        }
        if (directive.kind === "arm_static_hazard") {
          const armed = core.armStaticHazardAt(
            directive.x,
            directive.y,
            directive.affinityKind,
            directive.affinityExpression,
            directive.stacks,
            directive.manaReserve,
          );
          if (Number.isFinite(armed) && armed === 0) {
            preCoreRejections.push({ action, reason: "arm_static_hazard_rejected" });
            continue;
          }
          acceptedActions.push(adaptation.action);
          continue;
        }
        if (directive.kind === "disarm_static_hazard") {
          core.disarmStaticHazardAt(directive.x, directive.y);
          acceptedActions.push(adaptation.action);
          continue;
        }
        if (directive.kind === "apply_attack") {
          if (typeof core?.applyAttack !== "function") {
            preCoreRejections.push({ action, reason: "missing_applyAttack_export" });
            continue;
          }
          // resolveActorIdNumeric returns 1-based IDs from actorIdMap; core.applyAttack
          // expects 0-based motivated actor indices. Convert here.
          const result = core.applyAttack(
            directive.attackerNumeric - 1,
            directive.defenderNumeric - 1,
            directive.damage,
          );
          if (result === 0) {
            preCoreRejections.push({ action, reason: "attack_rejected_by_core" });
            continue;
          }
          acceptedActions.push(adaptation.action);
          continue;
        }
        preCoreRejections.push({ action, reason: "unsupported_directive" });
        continue;
      }
      if (adaptation.kind === ACTION_KIND.Move) {
        if (typeof core?.setMoveAction !== "function" || typeof core?.applyAction !== "function") {
          preCoreRejections.push({ action, reason: "missing_move_exports" });
          continue;
        }
        // AM.1 — a move core REFUSED is not an accepted action. Before this,
        // applyMoveAction returned void and only a thrown error was caught, so
        // a rejection (WrongActor, BlockedByWall, TickMismatch, ...) was
        // recorded as acceptance and the run reported movement that never
        // happened. The reason name comes from core-ts, not a local table.
        let moveResult;
        try {
          moveResult = applyMoveAction(core, adaptation.value);
        } catch (err) {
          preCoreRejections.push({ action, reason: err?.message || "move_failed" });
          continue;
        }
        if (moveResult !== ValidationError.None) {
          preCoreRejections.push({
            action,
            reason: `move_rejected_by_core:${getValidationErrorName(moveResult)}`,
          });
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
      affinityEffects = options.affinityEffects || null;
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
      // P5.5 — the applied caps are RETAINED now, because they are the "issued"
      // half of the Allocator's reconciliation. Previously this return value was
      // dropped, which is a small part of why nothing could compare issued spend
      // against actual: one half was discarded and the other was never read.
      appliedBudgetCaps = applyBudgetCaps(core, simConfig);
      // Action costs are Allocator policy; core enforces but must not price.
      applyActionBudgetCosts(core, createAllocatorPersona({ clock: UNUSED_CLOCK }).pricing.actionBudgetCosts());

      ensureOrchestrator();

      const frameEffects = flushEffects({ core, adapters, effectFactory, tick, effectLog, moderator });
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

      // Moderator "pausing" must gate real tick advancement, not just record a
      // label (charter: label-only states are defects). A tick already in
      // flight when pause is requested still completes this call; only a call
      // that BEGINS already-paused is refused. "resume" (any of the aliases
      // buildPersonaEvents accepts) unblocks within the same call.
      const moderatorState = orchestrator.view().personaStates?.moderator?.state;
      const requestedControlEvent = stepOptions.controlEvent || stepOptions.control || stepOptions.moderatorEvent;
      if (moderatorState === "pausing" && requestedControlEvent !== "resume") {
        return core.getCounter ? core.getCounter() : null;
      }

      const currentPhase = orchestrator.view().phase;
      const layoutHazards = simConfig?.layout?.data?.hazards || [];
      // Build sorted actor ID list so readObservation labels all actors by their original IDs.
      // actorIdMap maps id → 1-based numeric index; sort by index to get core ordering.
      const sortedActorIds = actorIdMap.size > 0
        ? Array.from(actorIdMap.entries()).sort((a, b) => a[1] - b[1]).map(([id]) => id)
        : [];
      // Deterministic decide-phase iteration order: initialState.actors array
      // order (filtered to actors the core actually tracks), not the
      // alphabetically-sorted numeric-index order used for core observation
      // labeling above. Every tracked actor must get a chance to propose an
      // action each tick — see tests/runtime/multi-actor-orchestration.test.js.
      const decideActorIds = Array.isArray(initialState?.actors)
        ? initialState.actors.map((a) => a?.id).filter((id) => id && actorIdMap.has(id))
        : sortedActorIds;
      const observation = resolveObservation(core, primaryActorId, baseTiles, affinityEffects, layoutHazards, sortedActorIds);
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

      // Advance the actor persona once per tracked actor (deterministic
      // initialState order) so every actor gets a chance to propose a
      // move/wait action each tick, not just initialState.actors[0]. Only
      // the first pass transitions the shared tick-phase FSM
      // (OBSERVE -> DECIDE); subsequent passes redispatch within the same
      // DECIDE phase. Non-actor personas receive no event override on
      // repeat passes, so collectPhaseRecord() treats them as pure view()
      // reads (see packages/runtime/src/personas/_shared/tick-orchestrator.mts).
      const decideActorIterationIds = decideActorIds.length > 0 ? decideActorIds : [primaryActorId];
      const actions = [];
      let decideRecord = null;
      let decidePersonaPayloads = null;
      for (let i = 0; i < decideActorIterationIds.length; i += 1) {
        const actorId = decideActorIterationIds[i];
        // Targets already claimed by actors decided earlier in this same
        // tick, so two actors can't both propose a move onto the same
        // currently-unoccupied tile before core state updates at APPLY time.
        const reservedTargets = actions
          .filter((a) => a?.kind === "move" && a.params?.to)
          .map((a) => ({ x: a.params.to.x, y: a.params.to.y }));
        decidePersonaPayloads = buildPersonaPayloads({
          phase: TickPhases.DECIDE,
          observation,
          phaseInputs: stepOptions,
          actorId,
          reservedTargets,
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
        let record;
        if (i === 0) {
          record = await orchestrator.stepPhase("decide", decideInputs);
        } else {
          // The actor persona is a single shared FSM instance (cooldown after
          // the previous actor's turn only accepts "observe"). Recycle it
          // through observe -> decide before this actor's propose/cooldown.
          // personaEvents scopes these transitions to the actor persona only;
          // every other persona sees no override and is treated as a pure
          // view() read (see tick-orchestrator.mts collectPhaseRecord()).
          await orchestrator.dispatchPhase({
            phase: TickPhases.DECIDE,
            event: "observe",
            payload: {
              personaTick: tick,
              personaEvents: { actor: "observe" },
              personaPayloads: decidePersonaPayloads,
            },
          });
          record = await orchestrator.dispatchPhase({
            phase: TickPhases.DECIDE,
            event: "decide",
            payload: {
              personaTick: tick,
              personaEvents: { actor: ["decide", "propose"] },
              personaPayloads: decidePersonaPayloads,
            },
          });
        }
        const actorState = record.personaViews?.actor?.state;
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
          record.personaViews = cooldownRecord.personaViews;
        }
        if (Array.isArray(record.actions) && record.actions.length) {
          actions.push(...record.actions);
        }
        decideRecord = record;
      }

      applyPersonaArtifacts(decideRecord);
      recordTickFrame({
        phaseDetail: TickPhases.DECIDE,
        personaViews: decideRecord.personaViews,
        personaActions: actions,
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
      const applyActions = Array.isArray(applyRecord.actions) ? applyRecord.actions : [];
      const applied = applyActionsToCore(actions.concat(applyActions));

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

      const frameEffects = flushEffects({ core, adapters, effectFactory, tick, effectLog, moderator });
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

      // AM.3 — the tick closes HERE, once, after every phase of this step.
      //
      // core.advanceTick() applies per-tick regen (actor vitals, hazard mana and
      // durability) and increments the tick. It used to be reachable only from
      // move.ts commitMove, which made all of that a function of how many actors
      // happened to move. Advancing once per step() makes elapsed time a
      // property of the simulation.
      //
      // Placed after SUMMARIZE so actions applied during this step belong to the
      // tick they were proposed for: `action.tick === getCurrentTick() + 1` still
      // holds during APPLY, and every actor acting in the same step now shares
      // one tick number instead of each successful move bumping it for the next.
      //
      // A step that begins while the Moderator is `pausing` already returns
      // before reaching this point, so a paused tick advances nothing.
      if (typeof core.advanceTick === "function") {
        core.advanceTick();
      }

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
    // CR.8 — the RunSummary is produced by the Annotator that actually observed the
    // run. kernel.js used to mint a fresh `createAnnotatorPersona({ clock: UNUSED_CLOCK })`
    // purely to call summarizeRun and stamp producedBy:"annotator": the instance that
    // recorded every tick frame was discarded, and one that had recorded nothing signed
    // the artifact (A5, honest provenance).
    //
    // Deliberately narrow: the persona registry stays private, so glue still cannot
    // reach persona internals. The derivation itself is unchanged — P3.2's
    // deriveRunOutcome is correct and this only fixes WHO runs it.
    summarizeRun(args = {}) {
      if (!annotator || typeof annotator.summarizeRun !== "function") {
        const error = new Error(
          "Runtime has no Annotator to summarize the run: the RunSummary is Annotator work (CR.8), "
          + "so glue must not synthesize one to sign the artifact.",
        );
        error.code = "annotator_required";
        throw error;
      }
      // The A5 gate. A run that actually TICKED drove this instance through
      // recording -> summarizing; an instance still `idle` cannot have observed it,
      // which is exactly what a freshly constructed stand-in looks like.
      //
      // Keyed on ticked frames, not on frame count: init() alone records one "init"
      // frame, so a zero-tick run legitimately ends with an unobserved Annotator and
      // an empty summary. That is honest, and gating on `length > 0` wrongly failed it.
      const ticked = tickFrames.some((frame) => frame?.phaseDetail && frame.phaseDetail !== "init");
      const state = annotator.view?.().state;
      if (ticked && state === "idle") {
        const error = new Error(
          `Annotator never observed this run (state=${state}) but was asked to summarize a run that `
          + "ticked: the summary would carry a provenance stamp it did not earn.",
        );
        error.code = "annotator_did_not_observe";
        throw error;
      }
      return annotator.summarizeRun(args);
    },

    /**
     * AM.0b — the end-of-run world-state snapshot (closes F11).
     *
     * Same ownership and the same provenance gate as summarizeRun: capturing and
     * normalizing run observability is Annotator work, so glue asks the persona
     * that observed the run rather than minting a stand-in to sign the artifact.
     *
     * `core` and `actorIdMap` are supplied HERE rather than by the caller: they
     * are the runtime's own handles, and a caller passing its own core could
     * snapshot a world this run never touched.
     */
    captureWorldState(args = {}) {
      if (!annotator || typeof annotator.captureWorldState !== "function") {
        const error = new Error(
          "Runtime has no Annotator to capture world state: the snapshot is Annotator work, "
          + "so glue must not synthesize one to sign the artifact.",
        );
        error.code = "annotator_required";
        throw error;
      }
      const ticked = tickFrames.some((frame) => frame?.phaseDetail && frame.phaseDetail !== "init");
      const state = annotator.view?.().state;
      if (ticked && state === "idle") {
        const error = new Error(
          `Annotator never observed this run (state=${state}) but was asked to snapshot a run that `
          + "ticked: the snapshot would carry a provenance stamp it did not earn.",
        );
        error.code = "annotator_did_not_observe";
        throw error;
      }
      return annotator.captureWorldState({ ...args, core, actorIdMap });
    },

    /**
     * P5.5 — coordinate the effects this run deferred, after the run.
     *
     * Chartered Orchestrator work that did not exist: `dispatchEffect` marked IO-bound
     * effects `deferred`, the Moderator recorded the disposition, and the only thing
     * downstream was `ak inspect`, which counted them. The records then went nowhere, and
     * a run that dropped every deferral looked identical to one that had none.
     *
     * The sequencing is the charter's, not a convenience: this runs only after the ticks
     * are done and the run's facts are final, and nothing it obtains is fed back into the
     * simulation. The round decides and returns effects; the port dispatches them; the
     * adapter does the IO.
     *
     * @returns {{runId: string|null, deferredCount: number, captures: Array<object>,
     *   outstanding: Array<object>} | null} null when the run deferred nothing — which is
     *   distinct from a settlement with an empty capture list, and the round refuses to
     *   blur the two.
     */
    coordinateDeferredEffects({ clock: overrideClock, meta } = {}) {
      // The A5 gate, the same shape as summarizeRun's: the persona that hosts the round
      // must be the one in this run's registry. A stand-in minted here to sign the
      // captures is the CR.8 façade, one artifact over.
      if (typeof orchestratorPersona?.createPostRunCoordinationRound !== "function") {
        const error = new Error(
          "Runtime has no Orchestrator that can coordinate deferred effects: post-run "
          + "side-effect coordination is Orchestrator work (charter), so glue must not "
          + "fulfil the deferrals itself.",
        );
        error.code = "orchestrator_required";
        throw error;
      }

      const deferred = collectDeferredEffects(tickFrames);
      if (deferred.length === 0) {
        return null;
      }

      const round = orchestratorPersona.createPostRunCoordinationRound({
        deferred,
        runId: activeRunId,
        clock: overrideClock || activeClock,
        meta,
      });
      const { effects: postRunEffects } = round.begin();

      for (const effect of postRunEffects) {
        const outcome = typeof effects.dispatchEffect === "function"
          ? effects.dispatchEffect(adapters, effect)
          : { status: "deferred", reason: "missing_dispatchEffect" };
        round.fulfill({
          coordinationId: effect.coordinationId,
          status: outcome?.status,
          payload: outcome?.result,
          reason: outcome?.reason,
          adapter: effect.targetAdapter,
        });
      }

      return round.settle().result;
    },
  };
}
