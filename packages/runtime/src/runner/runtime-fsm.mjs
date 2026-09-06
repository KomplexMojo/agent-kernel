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
import {
  createModeratorPersona,
  FulfillmentDispositions,
  orderActorsByIntention,
} from "../personas/moderator/persona.js";
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
import {
  scopeObservation,
  SIGHT_AFFINITY_KINDS,
} from "../../../core-ts/src/state/visibility.ts";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_OPPOSITES,
  resolveActorFaction,
} from "../contracts/domain-constants.js";
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
/** Vital index for mana, matching core's VitalKind ordering. */
const VITAL_MANA = 1;

/**
 * AM.5 — the authored per-cast mana price, read off the Configurator's public
 * surface. The rules artifact is the authority (AM.4); its published default
 * applies when a run supplies no artifact of its own, which is a documented
 * default table rather than a silent fallback to a second price model.
 */
const configuratorAffinityManaCost = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .resolveAffinityManaCost;

function resolveCastManaCost({ kind, expression, stacks }) {
  return configuratorAffinityManaCost({ rules: null, kind, expression, stacks });
}

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

function resolveObservation(core, actorIdLabel, baseTiles, affinityEffects, layoutHazards = [], actorIds = [], initialState = null) {
  if (!core || !canReadObservation(core)) return null;
  try {
    const observation = readObservation(core, { actorIdLabel, affinityEffects, actorIds });

    // DS.1 — attach each actor's faction, which core cannot supply.
    //
    // `core-ts` has no concept of role (no `getMotivatedActorRole`, nothing);
    // faction is a config-level idea, so the snapshot core builds carries none.
    // The Actor's hostility rule reads `role`, so without this enrichment every
    // actor's role is `undefined` in a real run, every pair falls through to
    // DS.2's unknown-role fail-safe, and delvers keep attacking delvers while
    // the persona suite stays green.
    //
    // Same shape as the hazard-vitals enrichment directly below: config data the
    // observation needs and core does not hold. An existing role is never
    // overwritten, so a hand-built observation stays authoritative over config.
    if (observation && Array.isArray(observation.actors) && Array.isArray(initialState?.actors)) {
      const factionById = new Map();
      initialState.actors.forEach((configActor) => {
        if (!configActor?.id) return;
        const faction = resolveActorFaction(configActor);
        if (faction) factionById.set(configActor.id, faction);
      });
      if (factionById.size > 0) {
        observation.actors = observation.actors.map((actor) => {
          if (!actor?.id || actor.role) return actor;
          const faction = factionById.get(actor.id);
          return faction ? { ...actor, role: faction } : actor;
        });
      }
    }

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
    case "cast_affinity": {
      // AM.5 — an actor expressing an affinity at a target.
      //
      // Routed by TARGET CLASS to the three core entry points that already
      // existed and had no production caller (F5). Nothing about the effect is
      // decided here: core owns the matrix, the vital routing and the range
      // rule. This resolves ids to indices and hands over.
      const affinityKind = AFFINITY_KIND_CODES[String(params.kind || "").toLowerCase()];
      const affinityExpression = AFFINITY_EXPRESSION_CODES[String(params.expression || "").toLowerCase()];
      const stacks = toInt(params.stacks);
      if (!Number.isFinite(affinityKind) || !Number.isFinite(affinityExpression)) {
        return { ok: false, reason: "invalid_affinity_spec" };
      }
      if (!Number.isFinite(stacks) || stacks <= 0) {
        return { ok: false, reason: "invalid_affinity_stacks" };
      }
      const casterNumeric = resolveActorIdNumeric({ actorId: action.actorId, actorIdMap, core });
      if (!Number.isFinite(casterNumeric)) {
        return { ok: false, reason: "unknown_caster" };
      }

      const targetX = toInt(params.target?.x);
      const targetY = toInt(params.target?.y);
      const hasCell = Number.isFinite(targetX) && Number.isFinite(targetY);
      if (params.targetId) {
        const targetNumeric = resolveActorIdNumeric({ actorId: params.targetId, actorIdMap, core });
        if (!Number.isFinite(targetNumeric)) {
          return { ok: false, reason: "unknown_cast_target" };
        }
        return {
          ok: true,
          action: { ...action, tick: actionTick },
          direct: {
            kind: "cast_affinity_actor",
            casterNumeric,
            targetNumeric,
            affinityKind,
            affinityExpression,
            stacks,
            expressionName: String(params.expression || "").toLowerCase(),
            kindName: String(params.kind || "").toLowerCase(),
          },
        };
      }
      if (!hasCell) {
        return { ok: false, reason: "missing_cast_target" };
      }
      return {
        ok: true,
        action: { ...action, tick: actionTick },
        direct: {
          kind: "cast_affinity_cell",
          casterNumeric,
          x: targetX,
          y: targetY,
          affinityKind,
          affinityExpression,
          stacks,
          expressionName: String(params.expression || "").toLowerCase(),
          kindName: String(params.kind || "").toLowerCase(),
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
  let allocator = null;
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
  const runtimeBudgetOutcomes = [];

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
    affinityInteractions = [],
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
    // AM.8 — only when something actually met, so a frame with no contact stays
    // the same shape it always was.
    if (affinityInteractions.length) {
      frame.affinityInteractions = affinityInteractions;
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
    // Runtime consumes the registered Allocator's published prices and asks
    // that same live instance to issue its descriptive receipt after application
    // is complete. Structural tests may provide a registry stub solely to test
    // ordering; those stubs remain registered untouched, while accounting gets a
    // real private Allocator rather than treating a non-price-bearing stub as one.
    const registeredAllocator = registry.allocator;
    allocator = registeredAllocator?.pricing?.runtimeActionCosts
      && typeof registeredAllocator.issueRuntimeBudgetReceipt === "function"
      ? registeredAllocator
      : createAllocatorPersona({ clock: activeClock });
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

  /**
   * DS.4/DS6.1 — narrow one observation to what a single actor can perceive.
   *
   * Glue holds no opinion about perception: it looks up a position it already
   * has, asks CORE how far that tile can see (`getVisibilityRadiusAt`, which
   * reads the affinity field the Moderator already recomputes each tick), and
   * asks CORE to do the narrowing (`scopeObservation`). DS6.1 also reads the
   * surviving target-dark field for positioned actors/hazards and passes it as
   * plain data. Radius, occlusion, and concealment policy all remain in
   * `core-ts/src/state/visibility.ts`; this function only sequences them, which
   * is the line the enforcement checklist draws.
   *
   * Returns the observation UNCHANGED when the actor cannot be located or the
   * core predates the capability — the same shape of capability check
   * `canReadObservation` already makes. Unchanged rather than emptied on
   * purpose: an emptied observation silently blinds an actor, and a blinded
   * actor still acts, it just acts on nothing.
   */
  function scopeObservationForActor(observation, observingActorId) {
    if (!observation || !observingActorId) return observation;
    if (typeof core?.getVisibilityRadiusAt !== "function") return observation;
    if (!Array.isArray(observation.actors)) return observation;

    const self = observation.actors.find((entry) => entry?.id === observingActorId);
    const position = self?.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return observation;
    }

    const darkStacksByCell = {};
    if (typeof core?.getAffinityFieldStacksAt === "function") {
      const positionedEntities = [
        ...observation.actors,
        ...(Array.isArray(observation.hazards) ? observation.hazards : []),
      ];
      for (const entity of positionedEntities) {
        const target = entity?.position;
        if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
        const stacks = core.getAffinityFieldStacksAt(
          target.x,
          target.y,
          SIGHT_AFFINITY_KINDS.DARK,
        );
        if (Number.isFinite(stacks) && stacks > 0) {
          darkStacksByCell[`${target.x},${target.y}`] = stacks;
        }
      }
    }

    return scopeObservation(
      observation,
      observingActorId,
      core.getVisibilityRadiusAt(position.x, position.y),
      { darkStacksByCell },
    );
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

    // DS.4 — the Actor decides from what it can SEE.
    //
    // Scoped HERE, at the one place `actorPayload` is constructed, rather than at
    // the two phases that call this function. That is deliberate and it is what
    // closes the OBSERVE/DECIDE asymmetry: the DECIDE phase loops per actor and
    // passes an `actorId`, while the OBSERVE phase passes none and falls back to
    // `primaryActorId`. Scoping at the call sites would have covered the DECIDE
    // loop and missed actor 0 — leaving perception dependent on an actor's index
    // in the roster. Both paths flow through this line instead.
    //
    // Only the ACTOR's payload is narrowed. The annotator and every other persona
    // keep the full observation below: this is one actor's perception, not a
    // truncation of telemetry or of tick control's view of the board.
    const observingActorId = actorId || primaryActorId;
    const actorPayload = {
      ...base,
      actorId: observingActorId,
      observation: scopeObservationForActor(observation, observingActorId),
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

  /**
   * AM.8 — resolve every affinity pair in contact this tick (closes F6).
   *
   * core's `resolveMotivatedActorAffinityInteraction` has existed and been
   * unit-tested throughout; its only consumer was the Configurator, at DESIGN
   * time. During play, two actors could stand inside each other's fields for a
   * whole run and nothing was ever resolved between them.
   *
   * What is APPLIED here is stack cancellation, and only that. The matrix yields
   * an effect CODE per side (Damage, ManaGain, AmplifiedDamage, ...) but no
   * magnitude for those codes, and inventing numbers for them would be authoring
   * game design rather than wiring what exists. Canceled stacks are different:
   * core computes the net figure itself, so writing it back is applying a value
   * the kernel defined. Every other outcome is RECORDED in the tick frame, so it
   * is observable and can be given semantics deliberately later.
   */
  function resolveAffinityInteractionsForTick() {
    if (typeof core.resolveMotivatedActorAffinityInteraction !== "function") return [];
    if (typeof core.getMotivatedActorCount !== "function") return [];

    const count = core.getMotivatedActorCount();
    if (count < 2) return [];

    const actorsForPlanning = [];
    for (let index = 0; index < count; index += 1) {
      actorsForPlanning.push({
        index,
        x: core.getMotivatedActorXByIndex(index),
        y: core.getMotivatedActorYByIndex(index),
        kind: core.getMotivatedActorAffinityKindByIndex?.(index) ?? 0,
        expression: core.getMotivatedActorAffinityExpressionByIndex?.(index) ?? 0,
        stacks: core.getMotivatedActorAffinityStacksByIndex?.(index) ?? 0,
      });
    }

    const pairs = moderator.advance({
      phase: TickPhases.APPLY,
      event: "plan_affinity_interactions",
      payload: {
        actors: actorsForPlanning,
        // core's own radius curve, injected — the runner does not decide where a
        // field ends, and a copy of the formula here would be a second authority.
        computeRadius: (expression, stacks) => core.computeAffinityRadius(expression, stacks),
      },
      tick,
    })?.affinityInteractions;
    if (!Array.isArray(pairs) || pairs.length === 0) return [];

    const resolved = [];
    for (const pair of pairs) {
      const ok = core.resolveMotivatedActorAffinityInteraction(pair.sourceIndex, pair.targetIndex);
      if (!ok) continue;

      const canceled = core.getLastInteractionCanceledStacks?.() ?? 0;
      const netSource = core.getLastInteractionNetSourceStacks?.() ?? 0;
      const netTarget = core.getLastInteractionNetTargetStacks?.() ?? 0;
      const record = {
        sourceIndex: pair.sourceIndex,
        targetIndex: pair.targetIndex,
        distance: pair.distance,
        relationship: core.getLastInteractionRelationship?.() ?? -1,
        sourceEffect: core.getLastInteractionSourceEffect?.() ?? 0,
        targetEffect: core.getLastInteractionTargetEffect?.() ?? 0,
        visualState: core.getLastInteractionVisualState?.() ?? 0,
        canceledStacks: canceled,
        netSourceStacks: netSource,
        netTargetStacks: netTarget,
      };

      // Cancellation is the one outcome with a magnitude core defines, so it is
      // the one that reaches the world. An affinity cancelled to zero stacks is
      // cleared outright rather than left at zero — a zero-stack affinity would
      // still read as "held" everywhere that checks for a kind.
      if (canceled > 0 && typeof core.setMotivatedActorAffinity === "function") {
        const source = actorsForPlanning[pair.sourceIndex];
        const target = actorsForPlanning[pair.targetIndex];
        // No `typeof` guard on the clear. An earlier draft had one, and because
        // `clearMotivatedActorAffinity` was missing from the core surface at the
        // time, an affinity cancelled to ZERO stacks silently kept its stacks —
        // the interaction reported netTarget 0 while core still read 2. A
        // capability this depends on is a requirement, not an option.
        if (netSource > 0) {
          core.setMotivatedActorAffinity(pair.sourceIndex, source.kind, source.expression, netSource);
        } else {
          core.clearMotivatedActorAffinity(pair.sourceIndex);
        }
        if (netTarget > 0) {
          core.setMotivatedActorAffinity(pair.targetIndex, target.kind, target.expression, netTarget);
        } else {
          core.clearMotivatedActorAffinity(pair.targetIndex);
        }
        record.applied = "stack_cancellation";
      } else {
        // Recorded, not applied: the matrix gives a code without a magnitude.
        record.applied = "recorded_only";
      }
      resolved.push(record);
    }
    return resolved;
  }

  /**
   * Put this tick's actions into the order the MODERATOR ruled, before core resolves them.
   *
   * This is the binding that makes the ordering real. Until it existed, actors resolved in
   * `initialState.actors` array order -- the sequence the build happened to emit -- and the
   * measurement in `scripts/testing/logic-actor-ordering.mjs` found 75% of two- and
   * three-actor scenarios had an outcome that depended on it: who claims a contested tile,
   * and whether a defender escapes a blow or takes it at 1 health.
   *
   * STABLE within an actor and for anything the ruling does not name. Actions whose actorId
   * the Moderator did not rank (telemetry from a persona, an unknown actor) keep their
   * relative position at the end rather than being dropped or hoisted -- reordering must
   * change WHO GOES FIRST and nothing else.
   */
  function orderActionsForResolution(pendingActions, intentions, actorIds) {
    const order = orderActorsByIntention({ actorIds, intentions });
    if (order.length === 0) return pendingActions;
    const rankByActor = new Map(order.map((id, index) => [id, index]));
    const unranked = order.length;
    return pendingActions
      .map((action, index) => ({
        action,
        index,
        rank: rankByActor.has(action?.actorId) ? rankByActor.get(action.actorId) : unranked,
      }))
      .sort((left, right) => (left.rank - right.rank) || (left.index - right.index))
      .map((entry) => entry.action);
  }

  function applyActionsToCore(actions) {
    const acceptedActions = [];
    const preCoreRejections = [];
    const outcomes = [];
    const defaultTick = tick;

    function recordOutcome(action, outcome, reason, appliedAction = action) {
      outcomes.push({
        actorId: typeof action?.actorId === "string" && action.actorId.trim() ? action.actorId : null,
        tick: Number.isInteger(appliedAction?.tick) && appliedAction.tick >= 0 ? appliedAction.tick : defaultTick,
        actionKind: typeof action?.kind === "string" && action.kind.trim() ? action.kind : "unknown",
        outcome,
        ...(reason ? { reason } : {}),
      });
    }
    function accept(action, appliedAction) {
      acceptedActions.push(appliedAction);
      recordOutcome(action, "accepted", undefined, appliedAction);
    }
    function reject(action, reason) {
      preCoreRejections.push({ action, reason });
      recordOutcome(action, "rejected", reason);
    }

    for (const action of actions) {
      const adaptation = adaptActionToCore({ action, core, actorIdMap, defaultTick });
      if (!adaptation.ok) {
        reject(action, adaptation.reason || "invalid_action");
        continue;
      }
      if (adaptation.direct) {
        const directive = adaptation.direct;
        if (directive.kind === "destroy_barrier") {
          const applied = typeof core.destroyBarrierAt === "function"
            ? core.destroyBarrierAt(directive.x, directive.y)
            : (core.setTileAt(directive.x, directive.y, TILE_CODES.floor), 1);
          if (Number.isFinite(applied) && applied === 0) {
            reject(action, "destroy_barrier_rejected");
            continue;
          }
          accept(action, adaptation.action);
          continue;
        }
        if (directive.kind === "raise_barrier") {
          const applied = typeof core.raiseBarrierAt === "function"
            ? core.raiseBarrierAt(directive.x, directive.y)
            : (core.setTileAt(directive.x, directive.y, TILE_CODES.barrier), 1);
          if (Number.isFinite(applied) && applied === 0) {
            reject(action, "raise_barrier_rejected");
            continue;
          }
          accept(action, adaptation.action);
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
            reject(action, "arm_static_hazard_rejected");
            continue;
          }
          accept(action, adaptation.action);
          continue;
        }
        if (directive.kind === "disarm_static_hazard") {
          core.disarmStaticHazardAt(directive.x, directive.y);
          accept(action, adaptation.action);
          continue;
        }
        if (directive.kind === "cast_affinity_actor" || directive.kind === "cast_affinity_cell") {
          // AM.5 — the caster pays FIRST, then the effect applies.
          //
          // Order is deliberate: a cast whose mana cannot be paid must not reach
          // the world at all. The price is the authored one from the affinity
          // rules artifact (AM.4) — core cannot supply it, since its own formula
          // charges 0 for push and pull, and a free cast is an unpriced resource.
          const manaCost = resolveCastManaCost({
            kind: directive.kindName,
            expression: directive.expressionName,
            stacks: directive.stacks,
          });
          if (manaCost === null) {
            reject(action, "affinity_rules_have_no_price_for_cast");
            continue;
          }
          const casterIndex = directive.casterNumeric - 1;
          if (manaCost > 0) {
            const spent = typeof core.spendMotivatedActorAffinityMana === "function"
              ? core.spendMotivatedActorAffinityMana(casterIndex, directive.affinityKind, manaCost)
              : 0;
            if (spent < manaCost) {
              // Grants could not cover it. Fall back to the actor's mana VITAL,
              // which is the pool a cast without a pooled grant draws on.
              const remaining = manaCost - spent;
              const current = core.getMotivatedActorVitalCurrentByIndex(casterIndex, VITAL_MANA);
              if (current < remaining) {
                reject(action, "insufficient_affinity_mana");
                continue;
              }
              core.setMotivatedActorVital(
                casterIndex,
                VITAL_MANA,
                current - remaining,
                core.getMotivatedActorVitalMaxByIndex(casterIndex, VITAL_MANA),
                core.getMotivatedActorVitalRegenByIndex(casterIndex, VITAL_MANA),
              );
            }
          }

          let applied = 0;
          if (directive.kind === "cast_affinity_actor") {
            applied = core.applyAffinityDamage(
              casterIndex,
              directive.targetNumeric - 1,
              directive.affinityKind,
              directive.affinityExpression,
              directive.stacks,
            );
          } else if (directive.expressionName === "pull") {
            // A pull at an armed hazard neutralizes it and banks its mana.
            applied = core.applyAffinityPullFromHazard(
              casterIndex,
              directive.x,
              directive.y,
              directive.affinityKind,
              directive.stacks,
            );
          } else {
            applied = core.applyAffinityDamageToHazard(
              casterIndex,
              directive.x,
              directive.y,
              directive.affinityKind,
              directive.affinityExpression,
              directive.stacks,
            );
          }
          if (!applied) {
            reject(action, "cast_rejected_by_core");
            continue;
          }
          accept(action, adaptation.action);
          continue;
        }
        if (directive.kind === "apply_attack") {
          if (typeof core?.applyAttack !== "function") {
            reject(action, "missing_applyAttack_export");
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
            reject(action, "attack_rejected_by_core");
            continue;
          }
          accept(action, adaptation.action);
          continue;
        }
        reject(action, "unsupported_directive");
        continue;
      }
      if (adaptation.kind === ACTION_KIND.Move) {
        if (typeof core?.setMoveAction !== "function" || typeof core?.applyAction !== "function") {
          reject(action, "missing_move_exports");
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
          reject(action, err?.message || "move_failed");
          continue;
        }
        if (moveResult !== ValidationError.None) {
          reject(action, `move_rejected_by_core:${getValidationErrorName(moveResult)}`);
          continue;
        }
      } else if (typeof core?.applyAction === "function") {
        const actionResult = core.applyAction(adaptation.kind, adaptation.value);
        if (Number.isFinite(actionResult) && actionResult !== ValidationError.None) {
          reject(action, `action_rejected_by_core:${getValidationErrorName(actionResult)}`);
          continue;
        }
      } else if (typeof core?.step === "function") {
        core.step();
      } else {
        reject(action, "missing_core_applyAction");
        continue;
      }
      accept(action, adaptation.action);
    }

    return { acceptedActions, preCoreRejections, outcomes };
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
      runtimeBudgetOutcomes.length = 0;
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
      ensureOrchestrator();
      // Action costs are Allocator policy; core enforces but must not price.
      applyActionBudgetCosts(core, allocator.pricing.runtimeActionCosts());

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
      // An actor that has LEFT THE LEVEL is not asked to decide (maintainer ruling,
      // 2026-09-05). Core owns the rule — two ticks ended on the exit tile — and the
      // runner only reads the verdict; recomputing "has it exited?" here would be a
      // second authority on a core state transition.
      const hasExited = (id) => {
        if (typeof core.isMotivatedActorExitedByIndex !== "function") return false;
        const oneBased = actorIdMap.get(id);
        return Number.isInteger(oneBased) && core.isMotivatedActorExitedByIndex(oneBased - 1) === true;
      };
      const decideActorIds = Array.isArray(initialState?.actors)
        ? initialState.actors.map((a) => a?.id).filter((id) => id && actorIdMap.has(id) && !hasExited(id))
        : sortedActorIds.filter((id) => !hasExited(id));
      const observation = resolveObservation(core, primaryActorId, baseTiles, affinityEffects, layoutHazards, sortedActorIds, initialState);
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
      // ACCUMULATED ACROSS THE LOOP, not read off `decideRecord`. The loop advances the Actor
      // once PER ACTOR and keeps only the last record, so reading intentions from it would
      // surface exactly one actor's -- and every other actor would sort at class 0, handing
      // resolution order back to the array order this exists to replace.
      const tickIntentions = [];
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
        if (Array.isArray(record.intentions) && record.intentions.length) {
          tickIntentions.push(...record.intentions);
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
      const resolutionOrdered = orderActionsForResolution(actions, tickIntentions, decideActorIterationIds);
      const applied = applyActionsToCore(resolutionOrdered.concat(applyActions));
      runtimeBudgetOutcomes.push(...applied.outcomes);

      // AM.8 — resolve the affinity fields that are in CONTACT, after the tick's
      // actions have moved everyone. The Moderator decides which pairs meet;
      // core's 48-cell matrix decides what happens between them.
      const affinityInteractions = resolveAffinityInteractionsForTick();

      applyPersonaArtifacts(applyRecord);
      recordTickFrame({
        phaseDetail: TickPhases.APPLY,
        acceptedActions: applied.acceptedActions,
        preCoreRejections: applied.preCoreRejections,
        affinityInteractions,
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

      // AM.3 / AM.3b / AM.7 — the tick closes HERE, once, and the MODERATOR
      // decides what closing means.
      //
      // core.advanceTick() applies per-tick regen (actor vitals, hazard mana and
      // durability) and increments the tick; it used to be reachable only from
      // move.ts commitMove, which made all of that a function of how many actors
      // happened to move. computeAffinityField() ran only during setup, so auras
      // stayed where actors had started (F7).
      //
      // Both describe the same instant, so both belong to one decision. Glue asks
      // and executes; it does not decide. Placed after SUMMARIZE so actions
      // applied during this step belong to the tick they were proposed for —
      // `action.tick === getCurrentTick() + 1` still holds during APPLY, and every
      // actor acting in the same step shares one tick number.
      // Asked of the Moderator DIRECTLY, the same way tick ordering and effect
      // fulfilment are (plan_persona_order / plan_effect_fulfillment). A planning
      // event answers a question as data; routing it through the shared phase FSM
      // would ask every persona to make a transition none of them has.
      const tickClose = moderator.advance({
        phase: TickPhases.SUMMARIZE,
        event: "plan_tick_close",
        payload: {},
        tick,
      })?.tickClose;
      if (!tickClose || typeof tickClose.advanceTick !== "boolean") {
        throw new Error(
          "Moderator did not return a tick-close plan: advancing the tick and recomputing the "
          + "affinity field are Moderator policy (charter §29/§81), so the runner has no decision "
          + "of its own to fall back on.",
        );
      }

      if (tickClose.advanceTick && typeof core.advanceTick === "function") {
        core.advanceTick();
      }
      if (tickClose.recomputeAffinityField && typeof core.computeAffinityField === "function") {
        // Actors have moved; their auras must move with them. Without this the
        // field is a snapshot of the starting positions for the whole run.
        core.computeAffinityField();
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

    /**
     * T3.1b — runtime owns application facts, while the live Allocator remains
     * the sole owner of unit prices and receipt totals.
     */
    issueRuntimeBudgetReceipt({ meta } = {}) {
      if (!allocator || typeof allocator.issueRuntimeBudgetReceipt !== "function") {
        const error = new Error(
          "Runtime has no Allocator to issue a runtime budget receipt: runtime may capture outcomes but may not price them.",
        );
        error.code = "allocator_required";
        throw error;
      }
      return allocator.issueRuntimeBudgetReceipt({
        outcomes: runtimeBudgetOutcomes.map((outcome) => ({ ...outcome })),
        meta,
      });
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
