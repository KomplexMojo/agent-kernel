import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { applyBudgetCaps, applyActionBudgetCosts, readBudgetLedger } from "../ports/budget.js";
import * as effects from "../ports/effects.js";
import { createSolverPort } from "../ports/solver.js";
import { createTickOrchestrator } from "../personas/_shared/tick-orchestrator.mts";
import { TickPhases } from "../personas/_shared/tick-state-machine.mts";
import { createActorPersona, normalizeActorCommand, normalizeActorStrategy } from "../personas/actor/persona.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createAnnotatorPersona } from "../personas/annotator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createDirectorPersona } from "../personas/director/persona.js";
import {
  createModeratorPersona,
  FulfillmentDispositions,
  orderActorsByIntention,
  orderActorsForDecision,
} from "../personas/moderator/persona.js";
import { createOrchestratorPersona, collectDeferredEffects } from "../personas/orchestrator/persona.js";
import { initializeCoreFromArtifacts } from "./core-setup.mjs";
import { ASCII_TERRAIN_GLYPHS } from "../render/visualization-snapshot.js";
import { createActorTurn } from "../../../core-ts/src/rules/actor-turn.ts";
import {
  readActorRegistryDarkCells,
  readActorRegistryFieldCells,
  readActorRegistryObservation,
  readActorRegistryRevealLevels,
  readActorRegistryVisibleCells,
  scopeActorRegistryObservation,
} from "../../../core-ts/src/rules/actor-observation.ts";
import {
  getValidationErrorName,
  ValidationError,
} from "../../../core-ts/src/index.ts";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
} from "../contracts/domain-constants.js";
import {
  ACTION_SCHEMA,
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
});

const configuratorPersonaSurface = createConfiguratorPersona({ clock: UNUSED_CLOCK });

/**
 * Every affinity has a mana cost (maintainer, 2026-10-11). Persistent
 * expressions (emit, draw) pay a per-tick upkeep, authored by the Configurator
 * (`computeInternalManaUpkeep`, 2 + stacks). Core charges it from this table,
 * indexed by stacks; the last entry covers anything higher, so upkeep stops
 * rising past 100 stacks. The rule has no such cap; the table stops there only
 * because stack n costs n² budget tokens, so 100 stacks of one affinity cost
 * over 330,000 tokens, far beyond any level's budget. Raise this if budgets
 * ever reach it.
 */
const PERSISTENT_UPKEEP_TABLE_STACKS = 100;
const persistentAffinityUpkeepTable = Object.freeze(
  Array.from({ length: PERSISTENT_UPKEEP_TABLE_STACKS + 1 }, (_, stacks) => (
    stacks === 0 ? 0 : configuratorPersonaSurface.computeInternalManaUpkeep(stacks)
  )),
);

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

// Player turns — `actorCommands` is keyed by actor id so a command reaches exactly one
// actor's DECIDE payload. `personaPayloads.actor` cannot do this: it is spread into every
// actor's payload. The runner only routes: what a command MEANS (its kinds, directions)
// is the Actor's vocabulary, so validation is the Actor's own normalizeActorCommand, called
// here only so a malformed command is refused before the tick starts, not mid-DECIDE.
function normalizeActorCommands(raw, isTrackedActor) {
  const commands = ensureRecord(raw, "actorCommands");
  const normalized = {};
  for (const [actorId, command] of Object.entries(commands)) {
    if (!isTrackedActor(actorId)) {
      throw new Error(`actorCommands names an actor the runtime does not track: ${actorId}`);
    }
    normalized[actorId] = normalizeActorCommand(command);
  }
  return normalized;
}

// Mid-game orders (Phase 2b) — `actorStrategies` is keyed by actor id like
// `actorCommands`: each entry replaces that actor's strategy from this tick on. The
// strategy's shape is the Actor's, checked here only so a malformed order is refused
// before the tick starts.
function normalizeActorStrategies(raw, isTrackedActor) {
  const strategies = ensureRecord(raw, "actorStrategies");
  const normalized = {};
  for (const [actorId, strategy] of Object.entries(strategies)) {
    if (!isTrackedActor(actorId)) {
      throw new Error(`actorStrategies names an actor the runtime does not track: ${actorId}`);
    }
    normalized[actorId] = normalizeActorStrategy(strategy);
  }
  return normalized;
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

function resolveBaseTiles(simConfig) {
  const terrain = simConfig?.layout?.data?.terrain;
  const width = simConfig?.layout?.data?.width;
  const height = simConfig?.layout?.data?.height;
  if (Array.isArray(terrain) && Number.isSafeInteger(width) && width > 0
    && Number.isSafeInteger(height) && height > 0 && terrain.length === width * height) {
    return Array.from({ length: height }, (_, y) => terrain
      .slice(y * width, (y + 1) * width).map(kind => ASCII_TERRAIN_GLYPHS[kind] || ASCII_TERRAIN_GLYPHS.wall).join(""));
  }
  const tiles = simConfig?.layout?.data?.tiles;
  if (Array.isArray(tiles)) return tiles;
  return null;
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

const UNIFIED_ACTOR_ACTIONS = new Set(["move", "cast_affinity", "raise_barrier", "equip_affinity", "unequip_affinity", "take", "wait"]);
const onlyParams = (params, required, optional = []) => required.every((key) => Object.hasOwn(params, key))
  && Object.keys(params).every((key) => required.includes(key) || optional.includes(key));

function normalizeUnifiedActorAction(action, defaultTick) {
  const kind = resolveActionKind(action);
  if (!UNIFIED_ACTOR_ACTIONS.has(kind)) return null;
  if (typeof action?.actorId !== "string" || !action.actorId.trim()) return null;
  const tick = Number.isSafeInteger(action.tick) && action.tick >= 0 ? action.tick : defaultTick;
  const envelope = { schema: ACTION_SCHEMA, schemaVersion: 1, actorId: action.actorId, tick };
  const params = resolveActionParams(action);
  if (kind === "wait") {
    if (action.params !== undefined && Object.keys(params).length > 0) return null;
    return { ...envelope, kind: "wait" };
  }
  if (kind === "move") {
    // `via` makes it a sprint (#437): two steps, `via` then `target`.
    if (!onlyParams(params, ["target"], ["via"]) || !params.target || (params.via !== undefined && !params.via)) return null;
    return { ...envelope, kind: "move", params: { target: { ...params.target }, ...(params.via ? { via: { ...params.via } } : {}) } };
  }
  if (kind === "raise_barrier") {
    // A push raised into an empty tile (#460).
    if (!onlyParams(params, ["target"], ["affinityKey"]) || !params.target || typeof params.target !== "object") return null;
    if (params.affinityKey !== undefined && typeof params.affinityKey !== "string") return null;
    const named = params.affinityKey !== undefined ? { affinityKey: params.affinityKey } : {};
    return { ...envelope, kind: "raise_barrier", params: { target: { x: params.target.x, y: params.target.y }, ...named } };
  }
  if (kind === "cast_affinity") {
    // At an actor (`targetId`) or at a tile (`target`, #413), never both.
    const atTile = onlyParams(params, ["target"], ["affinityKey"]);
    if (params.affinityKey !== undefined && typeof params.affinityKey !== "string") return null;
    const named = params.affinityKey !== undefined ? { affinityKey: params.affinityKey } : {};
    if (atTile) {
      if (!params.target || typeof params.target !== "object") return null;
      return { ...envelope, kind: "cast_affinity", params: { target: { x: params.target.x, y: params.target.y }, ...named } };
    }
    if (!onlyParams(params, ["targetId"], ["affinityKey"]) || typeof params.targetId !== "string") return null;
    return { ...envelope, kind: "cast_affinity", params: { targetId: params.targetId, ...named } };
  }
  if (kind === "equip_affinity") {
    if (!onlyParams(params, ["affinityKey"], ["replaceKey", "stacks", "intensity"]) || typeof params.affinityKey !== "string"
      || (params.replaceKey !== undefined && typeof params.replaceKey !== "string")
      || (params.stacks !== undefined && typeof params.stacks !== "number")
      || (params.intensity !== undefined && typeof params.intensity !== "number")) return null;
    return { ...envelope, kind: "equip_affinity", params: { affinityKey: params.affinityKey,
      ...(params.replaceKey !== undefined ? { replaceKey: params.replaceKey } : {}),
      ...(params.stacks !== undefined ? { stacks: params.stacks } : {}),
      ...(params.intensity !== undefined ? { intensity: params.intensity } : {}) } };
  }
  if (kind === "unequip_affinity") {
    if (!onlyParams(params, ["affinityKey"]) || typeof params.affinityKey !== "string") return null;
    return { ...envelope, kind: "unequip_affinity", params: { affinityKey: params.affinityKey } };
  }
  if (Object.keys(params).length !== 2 || typeof params.targetId !== "string"
    || typeof params.holdingId !== "string") return null;
  return { ...envelope, kind: "take",
    params: { targetId: params.targetId, holdingId: params.holdingId } };
}

function adaptActionToCore({ action, defaultTick, actorRegistry }) {
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
      // Hazards live in the actor registry; a run with no artifacts has none to arm.
      if (!actorRegistry) {
        return { ok: false, reason: "missing_actor_registry" };
      }
      return {
        ok: true,
        action: { ...action, tick: actionTick },
        direct: {
          kind: "arm_static_hazard",
          x,
          y,
          stacks,
          manaReserve,
          kindName: kind,
          expressionName: expression,
        },
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
  let actorRegistry = null;
  let actorCosts = null;
  let actorPresentation = null;
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
  // Last tick's actor intentions: the Moderator orders this tick's DECIDE pass from them (#164).
  let previousTickIntentions = [];

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
    emittedSnapshot = null,
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
    if (emittedSnapshot) frame.emittedSnapshot = emittedSnapshot;
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
   * Core's rule (`scopeActorRegistryObservation`): radius, occlusion and
   * concealment all stay in core-ts; glue only sequences. A run with no actor
   * registry has no actors and no observation, so it passes through unchanged.
   */
  function scopeObservationForActor(observation, observingActorId) {
    if (!observation || !observingActorId) return observation;
    if (actorRegistry) return scopeActorRegistryObservation(observation, observingActorId);
    return observation;
  }

  // The map half of fog of war, for one actor, right now. CORE decides which
  // cells are seen; remembering explored cells across ticks is the caller's
  // session state.
  function readVisibleCellsForActor(actorId) {
    if (!actorRegistry) return [];
    return readActorRegistryVisibleCells(readActorRegistryObservation(actorRegistry, tick), actorId);
  }

  // Core owns the exit rule; this only reads the actor's lifecycle verdict.
  function hasExited(id) {
    return actorRegistry ? actorRegistry.getActor(id)?.lifecycle === "exited" : false;
  }

  function buildPersonaPayloads({ phase, observation, phaseInputs = {}, actions = [], emittedEffects = [], fulfilledEffects = [], actorId, reservedTargets, command, strategyOrder } = {}) {
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
      ...(command !== undefined ? { command } : {}),
      ...(strategyOrder !== undefined ? { strategyOrder } : {}),
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
   * Put this tick's actions into the order the MODERATOR ruled, before core resolves them.
   *
   * This is the binding that makes the ordering real. Until it existed, actors resolved in
   * `initialState.actors` array order -- the sequence the build happened to emit -- and the
   * old-world measurement (the retired `actor_ordering` logic-sweep domain) found 75% of two-
   * and three-actor scenarios had an outcome that depended on it: who claims a contested tile,
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
    const actorTurn = actorRegistry && actorCosts
      ? createActorTurn(actorRegistry, defaultTick, { ...actorCosts, persistentUpkeep: [...persistentAffinityUpkeepTable] })
      : null;

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
      if (actorTurn && UNIFIED_ACTOR_ACTIONS.has(resolveActionKind(action))) {
        const normalized = normalizeUnifiedActorAction(action, defaultTick);
        if (!normalized) {
          reject(action, "unsupported_action_kind");
          continue;
        }
        if (!actorTurn.apply(normalized)) {
          // Core names the reason when it can (BlockedByWall, ActorCollision, ...),
          // in the same `prefix:Name` form as the old engine's move rejections.
          const why = actorTurn.lastRejection();
          reject(action, why ? `actor_action_rejected_by_core:${why}` : "actor_action_rejected_by_core");
          continue;
        }
        accept(action, normalized);
        continue;
      }
      const adaptation = adaptActionToCore({ action, defaultTick, actorRegistry });
      if (!adaptation.ok) {
        reject(action, adaptation.reason || "invalid_action");
        continue;
      }
      if (adaptation.direct) {
        const directive = adaptation.direct;
        if (directive.kind === "arm_static_hazard") {
          const armed = actorRegistry.persistOrSpawnHazardAt(
            { x: directive.x, y: directive.y },
            {
              kind: directive.kindName,
              expression: directive.expressionName,
              stacks: directive.stacks,
              manaReserve: directive.manaReserve,
            },
          );
          if (armed === false) {
            reject(action, "arm_static_hazard_rejected");
            continue;
          }
          accept(action, adaptation.action);
          continue;
        }
        reject(action, "unsupported_directive");
        continue;
      }
      if (typeof core?.applyAction === "function") {
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

    let actorFields = null;
    let exitedActorIds = [];
    let actorTurnSnapshot = null;
    let actorSnapshot = null;
    if (actorTurn) {
      actorTurn.closeActions();
      actorFields = actorTurn.resolveFields();
      actorTurn.regenerate();
      exitedActorIds = actorTurn.resolveExits() || [];
      actorTurnSnapshot = actorTurn.snapshot();
      actorSnapshot = actorRegistry.snapshot();
    }
    return { acceptedActions, preCoreRejections, outcomes,
      actorFields, exitedActorIds, actorTurn: actorTurnSnapshot, actorSnapshot };
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
      previousTickIntentions = [];
      frameCounter = 0;
      simConfig = options.simConfig || null;
      initialState = options.initialState || null;
      affinityEffects = options.affinityEffects || null;
      intentEnvelope = options.intentEnvelope || options.intent || null;
      planArtifact = options.planArtifact || options.plan || null;
      const mapping = buildActorIdMap(initialState);
      actorIdMap = mapping.map;
      primaryActorId = mapping.primaryActorId;
      actorRegistry = null;
      actorCosts = null;
      actorPresentation = null;
      baseTiles = null;

      core.init(seed);
      if (initialState && !simConfig) {
        throw new Error("Runtime requires the simulation config referenced by the initial state.");
      }
      if (simConfig && initialState) {
        const loaded = initializeCoreFromArtifacts({ simConfig, initialState });
        actorRegistry = loaded.registry;
        actorCosts = loaded.costs;
        actorPresentation = loaded.presentation;
        // A level's strategies are refused at load, not on the tick an actor first reads one.
        for (const strategy of Object.values(initialState.strategies ?? {})) normalizeActorStrategy(strategy);
      }
      baseTiles = resolveBaseTiles(simConfig);
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

      const actorCommands = normalizeActorCommands(stepOptions.actorCommands, (id) => actorIdMap.has(id));
      const actorStrategies = normalizeActorStrategies(stepOptions.actorStrategies, (id) => actorIdMap.has(id));
      const currentPhase = orchestrator.view().phase;
      // Deterministic decide-phase iteration order: initialState.actors array
      // order (filtered to actors the core actually tracks). Every tracked actor
      // must get a chance to propose an
      // action each tick — see tests/runtime/multi-actor-orchestration.test.js.
      // An actor that has LEFT THE LEVEL is not asked to decide (maintainer ruling,
      // 2026-09-05). Core owns the rule — two ticks ended on the exit tile — and the
      // runner only reads the verdict; recomputing "has it exited?" here would be a
      // second authority on a core state transition.
      const decideActorIds = Array.isArray(initialState?.actors)
        ? initialState.actors.map((a) => a?.id).filter((id) => id && actorIdMap.has(id)
          && !hasExited(id) && (!actorRegistry || actorRegistry.getActor(id)?.lifecycle === "alive"))
        : [];
      // A run with no artifacts has no actor registry, so no actors and nothing to observe.
      const observation = actorRegistry ? readActorRegistryObservation(actorRegistry, tick) : null;
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
      // The MODERATOR rules who proposes first, from last tick's intentions (#164): an
      // earlier decider claims contested tiles through `reservedTargets`, so this order is
      // load-bearing. Tick 1 has no intentions and falls back to id order.
      const decideActorIterationIds = decideActorIds.length > 0
        ? orderActorsForDecision({ actorIds: decideActorIds, previousIntentions: previousTickIntentions })
        : [primaryActorId];
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
          .filter((a) => a?.kind === "move" && a.params?.target)
          .map((a) => ({ ...a.params.target }));
        decidePersonaPayloads = buildPersonaPayloads({
          phase: TickPhases.DECIDE,
          observation,
          phaseInputs: stepOptions,
          actorId,
          reservedTargets,
          command: actorCommands[actorId],
          strategyOrder: actorStrategies[actorId],
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
      previousTickIntentions = tickIntentions;
      const applied = applyActionsToCore(resolutionOrdered.concat(applyActions));
      runtimeBudgetOutcomes.push(...applied.outcomes);

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
        emittedSnapshot: applied.actorSnapshot ? {
          tick,
          simConfigRef: simConfig?.meta ? {
            id: simConfig.meta.id,
            schema: simConfig.schema,
            schemaVersion: simConfig.schemaVersion,
          } : undefined,
          view: {
            registry: applied.actorSnapshot,
            turn: applied.actorTurn,
            fields: applied.actorFields,
            exitedActorIds: applied.exitedActorIds,
          },
        } : null,
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

      return core.getCounter ? core.getCounter() : null;
    },

    getState() {
      return { counter: core.getCounter ? core.getCounter() : 0 };
    },

    getActorSnapshot() {
      return actorRegistry ? actorRegistry.snapshot() : null;
    },

    getActorPresentation() {
      return actorPresentation ? structuredClone(actorPresentation) : null;
    },

    getEffectLog() {
      return effectLog.slice();
    },

    getTickFrames() {
      return tickFrames.slice();
    },

    /**
     * The current, UNSCOPED world observation with every tracked actor labelled by its
     * configured id and role — what a UI draws between ticks. Read-only; the same reader
     * the tick uses, so a UI never re-derives core's id-to-index mapping.
     */
    readObservation() {
      return actorRegistry ? readActorRegistryObservation(actorRegistry, tick) : null;
    },

    /**
     * Which cells `actorId` can see right now: a grid the map's shape, 1 visible / 0 not.
     * Core's rule (`computeVisibleCells`); `[]` when the actor is not on the map.
     */
    readVisibleCells(actorId) {
      return readVisibleCellsForActor(actorId);
    },

    /**
     * How much of each other living actor `actorId` can read right now (#416): core's
     * reveal level by actor id (`readActorRegistryRevealLevels`); `{}` without the registry.
     */
    readRevealLevels(actorId) {
      return actorRegistry ? readActorRegistryRevealLevels(readActorRegistryObservation(actorRegistry, tick), actorId) : {};
    },

    /**
     * Where dark outweighs light right now: a grid the map's shape, 1 dark / 0 not.
     * Core's rule (`readActorRegistryDarkCells`); `[]` without the actor registry.
     */
    readDarkCells() {
      return actorRegistry ? readActorRegistryDarkCells(readActorRegistryObservation(actorRegistry, tick)) : [];
    },

    /**
     * Every affinity field on each cell right now, after opposite pairs cancel (#287):
     * a grid the map's shape of `{ kind, stacks, falloff }` lists. Core's reading
     * (`readActorRegistryFieldCells`); `[]` without the actor registry.
     */
    readFieldCells() {
      return actorRegistry ? readActorRegistryFieldCells(readActorRegistryObservation(actorRegistry, tick)) : [];
    },

    /** Core's verdict on whether `actorId` has left the level. */
    hasActorExited(actorId) {
      return hasExited(actorId);
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
      return annotator.captureWorldState({
        ...args,
        registry: actorRegistry,
        presentation: actorPresentation,
        tick,
        simConfigRef: args.simConfigRef ?? (simConfig?.meta ? {
          id: simConfig.meta.id,
          schema: simConfig.schema,
          schemaVersion: simConfig.schemaVersion,
        } : null),
      });
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
