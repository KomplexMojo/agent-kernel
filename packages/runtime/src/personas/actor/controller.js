import { createActorStateMachine, ActorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildAction, buildRequestActionsFromEffects, buildSolverRequestEffect } from "../_shared/persona-helpers.mts";
import { EIGHT_WAY_DELTAS } from "../_shared/movement-directions.js";
import {
  RUNTIME_DECISION_CONTRACT,
  allowsLiveLlmRuntime,
  buildRuntimeDecisionEnvelope,
  resolveRuntimeDecisionProviderPolicy,
} from "../_shared/runtime-decision.mts";

export const actorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE]);

const SOLVER_REQUEST_SCHEMA = "agent-kernel/SolverRequest";
const SOLVER_ENGINE = "z3";

const DEFAULT_DELTAS = EIGHT_WAY_DELTAS;

const MOTIVATED_KIND = 2;

// CR.6 — AFFINITY_EXPRESSION_IDS, MOTIVATION_IDS, normalizeMotivationTier,
// resolveMotivationId, resolveAffinityExpressionId, hasBudgetAllowance and
// filterBudgetedProposals all moved to
// personas/allocator/proposal-admissibility.js. They existed only to serve the
// budget filter, and they resolved ids priced in the Allocator's base-costs.json —
// the Actor was reading the Allocator's price-list vocabulary to judge its own
// proposals. The Actor now emits candidates and the runner asks the Allocator.

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMotivatedKind(kind) {
  if (typeof kind === "number") return kind === MOTIVATED_KIND;
  // The actor contract only uses "stationary" | "ambulatory".
  // "ambulatory" actors CAN move and should have their proposals accepted.
  // Treat both "motivated" (legacy) and "ambulatory" as proposal-eligible.
  if (typeof kind === "string") {
    const k = kind.toLowerCase();
    return k === "motivated" || k === "ambulatory";
  }
  return false;
}

function resolveActorKind(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected && selected.kind !== undefined) {
      return selected.kind;
    }
  }
  if (view?.actor && (!actorId || view.actor.id === actorId)) {
    if (view.actor.kind !== undefined) {
      return view.actor.kind;
    }
  }
  if (!actorId && observation?.actorId && observation?.kind !== undefined) {
    return observation.kind;
  }
  return null;
}

function isMotivatedActor(actorId, view, observation) {
  if (!actorId) return false;
  const kind = resolveActorKind(view, actorId, observation);
  return isMotivatedKind(kind);
}

function findExitFromTiles(baseTiles) {
  if (!Array.isArray(baseTiles)) {
    return null;
  }
  for (let y = 0; y < baseTiles.length; y += 1) {
    const row = String(baseTiles[y]);
    const x = row.indexOf("E");
    if (x !== -1) {
      return { x, y };
    }
  }
  return null;
}

// CR.6 — resolves from the payload ONLY. This used to fall back to a
// `lastObservation` cached in the persona closure, which meant a propose could be
// decided from an observation the caller had not supplied on that call.
function resolveObservation(payload) {
  if (payload?.observation) return payload.observation;
  if (Array.isArray(payload?.observations) && payload.observations.length > 0) {
    return payload.observations[0];
  }
  if (payload?.view) return payload.view;
  return null;
}

function resolveObservationView(observation) {
  if (!observation || typeof observation !== "object") {
    return null;
  }
  if (observation.view && typeof observation.view === "object") {
    return observation.view;
  }
  return observation;
}

// CR.6 — the `if (lastBaseTiles) return lastBaseTiles` rung is gone; tiles come
// from this call's payload, this call's observation view, or this call's simConfig.
function resolveBaseTiles(payload, view, simConfig) {
  const fromPayload = payload?.baseTiles || payload?.tiles?.baseTiles;
  if (fromPayload) return fromPayload;
  if (view?.baseTiles) return view.baseTiles;
  if (view?.tiles?.baseTiles) return view.tiles.baseTiles;
  if (view?.tiles?.tiles) return view.tiles.tiles;
  const config = payload?.simConfig || simConfig;
  if (config?.layout?.data?.tiles) return config.layout.data.tiles;
  return null;
}

function resolveExit(payload, view, baseTiles, simConfigInput) {
  if (payload?.exit) return payload.exit;
  if (view?.exit) return view.exit;
  const simConfig = payload?.simConfig || simConfigInput;
  if (simConfig?.layout?.data?.exit) return simConfig.layout.data.exit;
  if (baseTiles) return findExitFromTiles(baseTiles);
  return null;
}

function resolveActor(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected?.position) {
      return { id: selected.id, position: selected.position };
    }
  }
  if (view?.actor) {
    const pos = view.actor.position || (Number.isFinite(view.actor.x) && Number.isFinite(view.actor.y) ? { x: view.actor.x, y: view.actor.y } : null);
    if (pos) {
      return { id: view.actor.id || actorId, position: pos };
    }
  }
  if (view?.position) {
    return { id: actorId || observation?.actorId, position: view.position };
  }
  return null;
}

function resolveActorRecord(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected) {
      return selected;
    }
  }
  if (view?.actor) {
    return view.actor;
  }
  return null;
}

function resolveConfiguredActor(payload, actorId) {
  const actors = Array.isArray(payload?.initialState?.actors) ? payload.initialState.actors : [];
  if (!actorId) return actors[0] || null;
  return actors.find((actor) => actor?.id === actorId) || null;
}

function resolveTileKinds(view, payload) {
  if (Array.isArray(view?.tiles?.kinds)) return view.tiles.kinds;
  if (Array.isArray(view?.kinds)) return view.kinds;
  if (Array.isArray(payload?.tiles?.kinds)) return payload.tiles.kinds;
  return null;
}

function buildAdjacentMoveProposals({ actor, tileKinds, baseTiles }) {
  if (!actor?.position) {
    return [];
  }
  const proposals = [];
  for (const delta of DEFAULT_DELTAS) {
    const to = {
      x: actor.position.x + delta.dx,
      y: actor.position.y + delta.dy,
    };
    if (!isPassable(to, tileKinds, baseTiles)) {
      continue;
    }
    proposals.push({
      kind: "move",
      params: {
        direction: delta.direction,
        from: actor.position,
        to,
      },
    });
  }
  return proposals;
}

function buildCandidateActionId(proposal, index) {
  if (!proposal || typeof proposal !== "object") {
    return `candidate_${index + 1}`;
  }
  if (typeof proposal.candidateId === "string" && proposal.candidateId.trim()) {
    return proposal.candidateId.trim();
  }
  const kind = typeof proposal.kind === "string" && proposal.kind.trim()
    ? proposal.kind.trim().toLowerCase()
    : "candidate";
  const params = isObject(proposal.params) ? proposal.params : proposal;
  if (kind === "move") {
    const direction = typeof params.direction === "string" && params.direction.trim()
      ? params.direction.trim().toLowerCase()
      : null;
    if (direction) return `move_${direction}`;
  }
  const targetId = typeof params.targetId === "string" && params.targetId.trim()
    ? params.targetId.trim()
    : null;
  if (targetId) {
    return `${kind}_${targetId}`;
  }
  return `${kind}_${index + 1}`;
}

function cloneCandidateParams(proposal) {
  if (!proposal || typeof proposal !== "object") {
    return {};
  }
  if (isObject(proposal.params)) {
    return { ...proposal.params };
  }
  return { ...proposal };
}

function buildRuntimeDecisionCandidateActions({ actor, actorId, tick, proposals = [], tileKinds, baseTiles }) {
  const baseCandidates = [];
  const seen = new Set();
  const addCandidate = (candidateId, action) => {
    const signature = `${action.kind}:${JSON.stringify(action.params || {})}`;
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    baseCandidates.push({
      id: candidateId,
      action,
    });
  };

  const proposalList = Array.isArray(proposals) ? proposals : [];
  proposalList.forEach((proposal, index) => {
    if (!proposal || typeof proposal !== "object") {
      return;
    }
    const kind = typeof proposal.kind === "string" && proposal.kind.trim() ? proposal.kind.trim() : "custom";
    addCandidate(
      buildCandidateActionId(proposal, index),
      buildAction({
        tick,
        kind,
        actorId,
        personaRef: "actor",
        params: cloneCandidateParams(proposal),
      }),
    );
  });

  const movementCandidates = buildAdjacentMoveProposals({ actor, tileKinds, baseTiles });
  movementCandidates.forEach((proposal, index) => {
    addCandidate(
      buildCandidateActionId(proposal, proposalList.length + index),
      buildAction({
        tick,
        kind: proposal.kind,
        actorId,
        personaRef: "actor",
        params: { ...proposal.params },
      }),
    );
  });

  addCandidate(
    "wait_here",
    buildAction({
      tick,
      kind: "wait",
      actorId,
      personaRef: "actor",
      params: {},
    }),
  );

  return baseCandidates;
}

function resolveVisibleActors(view, actorId) {
  const actors = Array.isArray(view?.actors) ? view.actors : [];
  return actors
    .filter((entry) => entry && entry.id && entry.id !== actorId)
    .map((entry) => {
      const next = {
        id: entry.id,
      };
      if (entry.kind !== undefined) next.kind = entry.kind;
      if (entry.role !== undefined) next.role = entry.role;
      if (entry.position) next.position = { ...entry.position };
      if (entry.vitals) next.vitals = JSON.parse(JSON.stringify(entry.vitals));
      return next;
    });
}

function resolveHazards(payload, view) {
  const hazards = [];
  const seen = new Set();

  function addHazard(entry) {
    if (!entry || typeof entry !== "object") return;
    const position = isObject(entry.position)
      ? { ...entry.position }
      : Number.isFinite(entry.x) && Number.isFinite(entry.y)
        ? { x: entry.x, y: entry.y }
        : null;
    if (!position) return;
    const kind = "hazard";
    const id = typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : `${kind}_${position.x}_${position.y}`;
    const key = `${id}:${position.x}:${position.y}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const next = { id, kind, position };
    const affinity = typeof entry.affinity === "string" && entry.affinity.trim()
      ? entry.affinity.trim()
      : typeof entry.affinity?.kind === "string" && entry.affinity.kind.trim()
        ? entry.affinity.kind.trim()
        : null;
    const expression = typeof entry.expression === "string" && entry.expression.trim()
      ? entry.expression.trim()
      : typeof entry.affinity?.expression === "string" && entry.affinity.expression.trim()
        ? entry.affinity.expression.trim()
        : null;
    const stacks = Number.isFinite(entry.stacks)
      ? entry.stacks
      : Number.isFinite(entry.affinity?.stacks)
        ? entry.affinity.stacks
        : null;
    if (expression) next.expression = expression;
    if (affinity) next.affinity = affinity;
    if (Number.isFinite(stacks)) next.stacks = Math.max(1, Math.trunc(stacks));
    hazards.push(next);
  }

  const explicitHazards = Array.isArray(payload?.hazards) ? payload.hazards : [];
  explicitHazards.forEach((entry) => addHazard(entry));

  const viewHazards = Array.isArray(view?.hazards) ? view.hazards : [];
  viewHazards.forEach((entry) => addHazard(entry));

  const affinityHazards = Array.isArray(payload?.affinityEffects?.hazards) ? payload.affinityEffects.hazards : [];
  affinityHazards.forEach((entry) => addHazard(entry));

  return hazards;
}

function extractMotivationGoals(configuredActor) {
  const motivations = configuredActor?.motivations || configuredActor?.traits?.motivations;
  if (!Array.isArray(motivations)) return [];
  const goals = [];
  for (const entry of motivations) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.goal || typeof entry.goal !== "object") continue;
    const goal = { kind: entry.kind };
    if (typeof entry.goal.type === "string") goal.type = entry.goal.type;
    if (typeof entry.goal.objective === "string") goal.objective = entry.goal.objective;
    if (entry.goal.params && typeof entry.goal.params === "object") {
      goal.params = { ...entry.goal.params };
    }
    goals.push(goal);
  }
  return goals;
}

function buildRuntimeDecisionObjectives({ configuredActor, visibleActors, exit }) {
  const objectives = {};
  const role = typeof configuredActor?.role === "string" && configuredActor.role.trim()
    ? configuredActor.role.trim()
    : null;
  if (role) {
    objectives.role = role;
  }
  if (visibleActors.length > 0) {
    objectives.primary = role === "boss" ? "control_visible_opponents" : "resolve_visible_contacts";
    objectives.visibleContactCount = visibleActors.length;
  } else if (exit) {
    objectives.primary = "advance_to_exit";
  }
  if (exit) {
    objectives.exit = { ...exit };
  }
  const goals = extractMotivationGoals(configuredActor);
  if (goals.length > 0) {
    objectives.goals = goals;
  }
  return Object.keys(objectives).length > 0 ? objectives : undefined;
}

function buildRuntimeDecisionConstraints({ actorRecord }) {
  const vitals = isObject(actorRecord?.vitals) ? actorRecord.vitals : null;
  if (!vitals) {
    return undefined;
  }
  const constraints = {};
  ["health", "mana", "stamina", "durability"].forEach((key) => {
    if (isObject(vitals[key])) {
      constraints[key] = {
        current: Number.isFinite(vitals[key].current) ? vitals[key].current : 0,
        max: Number.isFinite(vitals[key].max) ? vitals[key].max : 0,
      };
    }
  });
  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function resolveRuntimeDecisionConfig({ payload, actorId, view, observation }) {
  const configuredActor = resolveConfiguredActor(payload, actorId);
  const actorRecord = resolveActorRecord(view, actorId, observation);
  const actorTraits = isObject(configuredActor?.traits) ? configuredActor.traits : {};
  const runtimeDecisioning = payload?.runtimeDecisioning;
  const payloadDecisioning = runtimeDecisioning === true ? { enabled: true } : isObject(runtimeDecisioning) ? runtimeDecisioning : {};
  const configuredPolicy = isObject(configuredActor?.providerPolicy)
    ? configuredActor.providerPolicy
    : isObject(actorTraits.providerPolicy)
      ? actorTraits.providerPolicy
      : {};
  const mode = payloadDecisioning.mode
    || configuredActor?.decisionMode
    || actorTraits.decisionMode
    || configuredActor?.decisionProvider
    || actorTraits.decisionProvider
    || configuredPolicy.mode
    || configuredPolicy.preferred;
  const preferred = payloadDecisioning.preferred
    || configuredActor?.decisionProvider
    || actorTraits.decisionProvider
    || configuredPolicy.preferred;
  const enabled = payloadDecisioning.enabled === true
    || configuredActor?.runtimeDecisioning === true
    || actorTraits.runtimeDecisioning === true
    || Boolean(mode)
    || Boolean(preferred);
  if (!enabled) {
    return null;
  }
  const providerPolicy = resolveRuntimeDecisionProviderPolicy({
    ...configuredPolicy,
    ...(isObject(payloadDecisioning.providerPolicy) ? payloadDecisioning.providerPolicy : {}),
    ...(mode ? { mode } : {}),
    ...(preferred ? { preferred } : {}),
    ...(payloadDecisioning.liveLlmMode ? { liveLlmMode: payloadDecisioning.liveLlmMode } : {}),
    ...(payloadDecisioning.model ? { model: payloadDecisioning.model } : {}),
    ...(payloadDecisioning.baseUrl ? { baseUrl: payloadDecisioning.baseUrl } : {}),
    ...(payloadDecisioning.format ? { format: payloadDecisioning.format } : {}),
    ...(isObject(payloadDecisioning.options) ? { options: payloadDecisioning.options } : {}),
  });
  return {
    actorRecord,
    configuredActor,
    providerPolicy,
    liveLlmRuntime: allowsLiveLlmRuntime(providerPolicy),
    targetAdapter: payloadDecisioning.targetAdapter
      || payload?.targetAdapter
      || (providerPolicy.preferred === "llm" ? "ollama" : undefined),
  };
}

function buildArtifactRef(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return undefined;
  }
  if (!artifact.schema || !artifact.schemaVersion || !artifact.meta?.id) {
    return undefined;
  }
  return {
    id: artifact.meta.id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
  };
}

function buildRuntimeDecisionSolverRequest({ envelope, payload, actorId, tick, clock }) {
  const requestId = `solver_runtime_decision_${actorId || "actor"}_${tick}`;
  const providerPolicy = resolveRuntimeDecisionProviderPolicy(envelope?.providerPolicy);
  const request = {
    schema: SOLVER_REQUEST_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: requestId,
      runId: payload?.runId || "run_runtime_decision",
      createdAt: clock(),
      producedBy: "actor",
    },
    problem: {
      language: "custom",
      data: envelope,
    },
    options: {
      engine: providerPolicy.preferred === "llm" ? "custom" : SOLVER_ENGINE,
      params: {
        contract: RUNTIME_DECISION_CONTRACT,
        decisionKind: envelope.decisionKind,
        actorId,
        provider: providerPolicy.preferred,
      },
    },
  };
  const intentRef = buildArtifactRef(payload?.intentEnvelope) || payload?.intentRef;
  const planRef = buildArtifactRef(payload?.planArtifact) || payload?.planRef;
  const simConfigRef = buildArtifactRef(payload?.simConfig);
  if (intentRef) request.intentRef = intentRef;
  if (planRef) request.planRef = planRef;
  if (simConfigRef) request.simConfigRef = simConfigRef;
  return request;
}

function buildRuntimeDecisionEffect({ payload, observation, view, actorId, tick, baseTiles, exit }) {
  const decisionConfig = resolveRuntimeDecisionConfig({ payload, actorId, view, observation });
  if (!decisionConfig) {
    return null;
  }
  const actor = resolveActor(view, actorId, observation);
  const actorRecord = decisionConfig.actorRecord || resolveActorRecord(view, actorId, observation);
  if (!actor || !actorRecord) {
    return null;
  }
  const tileKinds = resolveTileKinds(view, payload);
  const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];
  const candidateActions = buildRuntimeDecisionCandidateActions({
    actor,
    actorId,
    tick,
    proposals,
    tileKinds,
    baseTiles,
  });
  if (candidateActions.length === 0) {
    return null;
  }
  const visibleActors = resolveVisibleActors(view, actorId);
  const hazards = resolveHazards(payload, view);
  const envelope = buildRuntimeDecisionEnvelope({
    decisionKind: "next_move",
    phase: "decide",
    tick,
    actor: {
      id: actorId,
      role: decisionConfig.configuredActor?.role || actorRecord?.role,
      kind: actorRecord?.kind,
      position: actor.position ? { ...actor.position } : undefined,
      vitals: isObject(actorRecord?.vitals) ? JSON.parse(JSON.stringify(actorRecord.vitals)) : undefined,
    },
    visibleActors,
    hazards,
    candidateActions,
    objectives: buildRuntimeDecisionObjectives({
      configuredActor: decisionConfig.configuredActor,
      visibleActors,
      exit,
    }),
    constraints: buildRuntimeDecisionConstraints({ actorRecord }),
    providerPolicy: decisionConfig.providerPolicy,
  });
  const solverEffect = buildSolverRequestEffect({
    solverRequest: buildRuntimeDecisionSolverRequest({
      envelope,
      payload,
      actorId,
      tick,
      clock: payload?.clock || (() => new Date().toISOString()),
    }),
    intentRef: payload?.intentRef,
    planRef: payload?.planRef,
    personaRef: "actor",
    targetAdapter: decisionConfig.targetAdapter,
  });
  if (!solverEffect) {
    return null;
  }
  return {
    envelope,
    solverEffect,
  };
}

function isPassable({ x, y }, tileKinds, baseTiles) {
  if (tileKinds) {
    const row = tileKinds[y];
    if (!Array.isArray(row)) return false;
    return row[x] === 0;
  }
  if (baseTiles) {
    if (y < 0 || y >= baseTiles.length) return false;
    const row = String(baseTiles[y]);
    const cell = row[x];
    if (!cell) return false;
    return cell !== "#" && cell !== "B";
  }
  return false;
}

function isDiagonalStepAllowed(current, next, tileKinds, baseTiles) {
  const dx = next.x - current.x;
  const dy = next.y - current.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
    return true;
  }
  return isPassable({ x: current.x + dx, y: current.y }, tileKinds, baseTiles)
    && isPassable({ x: current.x, y: current.y + dy }, tileKinds, baseTiles);
}

function findPath(start, goal, tileKinds, baseTiles) {
  if (!start || !goal) return null;
  if (start.x === goal.x && start.y === goal.y) return [start];
  const height = tileKinds ? tileKinds.length : baseTiles ? baseTiles.length : 0;
  const width = tileKinds && Array.isArray(tileKinds[0]) ? tileKinds[0].length : baseTiles && baseTiles[0] ? String(baseTiles[0]).length : 0;
  if (width === 0 || height === 0) return null;

  const queue = [start];
  const cameFrom = {};
  const startKey = `${start.x},${start.y}`;
  cameFrom[startKey] = null;
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current.x === goal.x && current.y === goal.y) {
      const path = [];
      let key = `${goal.x},${goal.y}`;
      while (key) {
        const [x, y] = key.split(",").map((v) => Number(v));
        path.unshift({ x, y });
        key = cameFrom[key];
      }
      return path;
    }
    for (const delta of DEFAULT_DELTAS) {
      const next = { x: current.x + delta.dx, y: current.y + delta.dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      const key = `${next.x},${next.y}`;
      if (Object.prototype.hasOwnProperty.call(cameFrom, key)) {
        continue;
      }
      if (!isPassable(next, tileKinds, baseTiles) || !isDiagonalStepAllowed(current, next, tileKinds, baseTiles)) {
        continue;
      }
      cameFrom[key] = `${current.x},${current.y}`;
      queue.push(next);
    }
  }
  return null;
}

function buildMoveProposal({ observation, payload, simConfig }) {
  const view = resolveObservationView(observation);
  if (!view) return [];
  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const exit = resolveExit(payload, view, baseTiles, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const actor = resolveActor(view, payload?.actorId, observation);
  if (!actor || !actor.position || !exit) return [];
  const actorRecord = resolveActorRecord(view, payload?.actorId, observation);
  if (actorRecord?.motivation?.mobility === "stationary") {
    return [{ kind: "wait", params: { reason: "stationary" } }];
  }
  const path = findPath(actor.position, exit, tileKinds, baseTiles);
  if (!path || path.length < 2) return [];
  const from = path[0];
  const to = path[1];
  const delta = { dx: to.x - from.x, dy: to.y - from.y };
  const direction = DEFAULT_DELTAS.find((entry) => entry.dx === delta.dx && entry.dy === delta.dy)?.direction;
  if (!direction) return [];
  return [
    {
      kind: "move",
      params: {
        direction,
        from,
        to,
      },
    },
  ];
}

// ── M5: Simple motivation helpers ──────────────────────────────────────────

const DEFAULT_ATTACK_DAMAGE = 2; // M1 contract: fixed deterministic damage

/**
 * Read the motivation kind string from the self-actor in the observation view.
 * Returns null if not found.
 */
/**
 * Resolve the motivation.kind for the actor.
 * Checks (in order):
 *   1. observation view actors (motivation set inline, e.g. in tests)
 *   2. payload.initialState.actors (runtime path — motivation stored in config, not core)
 */
function resolveActorMotivationKind(view, actorId, payload) {
  if (view?.actors && Array.isArray(view.actors)) {
    const self = view.actors.find((a) => a && a.id === actorId);
    if (self?.motivation?.kind) return self.motivation.kind;
  }
  const configActors = payload?.initialState?.actors;
  if (Array.isArray(configActors)) {
    const configActor = configActors.find((a) => a && a.id === actorId);
    if (configActor?.motivation?.kind) return configActor.motivation.kind;
  }
  return null;
}

/**
 * Find the nearest hostile actor (any actor other than self) by Chebyshev
 * distance. Returns { actor, distance } or null if no others exist.
 */
function resolveNearestHostile(view, actorId) {
  if (!view?.actors || !Array.isArray(view.actors)) return null;
  const selfActor = view.actors.find((a) => a && a.id === actorId);
  if (!selfActor?.position) return null;

  let nearest = null;
  let nearestDist = Infinity;
  for (const other of view.actors) {
    if (!other || other.id === actorId || !other.position) continue;
    const dist = Math.max(
      Math.abs(other.position.x - selfActor.position.x),
      Math.abs(other.position.y - selfActor.position.y),
    );
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = { actor: other, distance: dist };
    }
  }
  return nearest;
}

/**
 * Motivation-aware proposal builder. Routes to attack or hostile pursuit
 * before falling back to the existing exit pathfinding.
 *
 * Rules (from M1 contract):
 *   attacking  + adjacent hostile  → attack
 *   attacking  + non-adjacent      → move toward hostile
 *   defending  + adjacent hostile  → attack
 *   defending  + non-adjacent      → wait (no action)
 *   stationary                     → wait (no action)
 *   any        + no hostile        → existing exit pathfinding
 */
// ── M3: Random motivation helpers ──────────────────────────────────────────
//
// Deterministic, seed-derived pseudo-random selection — never Math.random(),
// never a clock read. The RNG is a pure function of (seed, actorId, tick):
// same inputs always produce the same output, independent of instance or
// call history, satisfying both the "identical seed -> identical trajectory"
// and "no shared mutable RNG state" requirements.

function resolveActorRandomSeed(view, actorId, payload, personaSeed) {
  if (view?.actors && Array.isArray(view.actors)) {
    const self = view.actors.find((a) => a && a.id === actorId);
    if (self?.motivation?.seed !== undefined && self.motivation.seed !== null) {
      return self.motivation.seed;
    }
  }
  const configActors = payload?.initialState?.actors;
  if (Array.isArray(configActors)) {
    const configActor = configActors.find((a) => a && a.id === actorId);
    if (configActor?.motivation?.seed !== undefined && configActor.motivation.seed !== null) {
      return configActor.motivation.seed;
    }
  }
  if (payload?.seed !== undefined && payload?.seed !== null) return payload.seed;
  if (personaSeed !== undefined && personaSeed !== null) return personaSeed;
  return 0;
}

/** Deterministic 32-bit hash of a seed/actorId/tick tuple (no Math.random, no clock). */
function hashRandomInputs(seed, actorId, tick) {
  const text = `${String(seed)}:${String(actorId)}:${String(Number.isFinite(tick) ? tick : 0)}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Final mix (mulberry32-style) so nearby hashes decorrelate before use.
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return hash >>> 0;
}

/** Pure deterministic RNG value in [0, 1) derived from seed + actorId + tick + salt. */
function deterministicRandom(seed, actorId, tick, salt = 0) {
  const hashed = hashRandomInputs(seed, actorId, (Number.isFinite(tick) ? tick : 0) * 2654435761 + salt);
  return hashed / 4294967296;
}

function isOccupied(position, view, actorId) {
  if (!view?.actors || !Array.isArray(view.actors)) return false;
  return view.actors.some(
    (other) => other && other.id !== actorId && other.position
      && other.position.x === position.x && other.position.y === position.y,
  );
}

function isReserved(position, reservedTargets) {
  if (!Array.isArray(reservedTargets) || reservedTargets.length === 0) return false;
  return reservedTargets.some((target) => target && target.x === position.x && target.y === position.y);
}

/**
 * Random motivation: choose among legal adjacent walkable, unoccupied tiles
 * using a deterministic seed-derived RNG. If the first choice is blocked,
 * bounce to another legal candidate (deterministically re-ordered, not
 * re-rolled with fresh entropy). If no legal adjacent tile exists, wait.
 *
 * `payload.reservedTargets` (array of {x,y}) carries move targets already
 * claimed by other actors earlier in the same DECIDE phase — the runtime
 * advances the actor persona once per actor per tick (see
 * packages/runtime/src/runner/runtime-fsm.mjs), so without this, two
 * actors evaluated in the same tick could both choose an identical
 * currently-unoccupied tile before core state is updated at APPLY time.
 */
function buildRandomMoveProposals({ observation, payload, simConfig, personaSeed }) {
  const view = resolveObservationView(observation);
  const actorId = payload?.actorId;
  const actor = resolveActor(view, actorId, observation);
  if (!actor?.position) return [{ kind: "wait", params: { reason: "random" } }];

  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const reservedTargets = payload?.reservedTargets;
  const candidates = buildAdjacentMoveProposals({ actor, tileKinds, baseTiles })
    .filter((proposal) => !isOccupied(proposal.params.to, view, actorId))
    .filter((proposal) => !isReserved(proposal.params.to, reservedTargets));

  if (candidates.length === 0) {
    return [{ kind: "wait", params: { reason: "random" } }];
  }

  const seed = resolveActorRandomSeed(view, actorId, payload, personaSeed);
  const roll = deterministicRandom(seed, actorId, payload?.tick, 0);
  const index = Math.floor(roll * candidates.length) % candidates.length;
  const chosen = candidates[index];

  return [
    {
      kind: "move",
      params: {
        direction: chosen.params.direction,
        from: chosen.params.from,
        to: chosen.params.to,
        reason: "random",
      },
    },
  ];
}

function buildMotivatedProposals({ observation, payload, simConfig, personaSeed }) {
  const view = resolveObservationView(observation);
  if (!view) return buildMoveProposal({ observation, payload, simConfig });

  const actorId = payload?.actorId;
  const actor = resolveActor(view, actorId, observation);
  if (!actor?.position) return buildMoveProposal({ observation, payload, simConfig });

  const motivationKind = resolveActorMotivationKind(view, actorId, payload);

  // Stationary: never propose movement
  if (motivationKind === "stationary") {
    return [];
  }

  // Random: seed-derived deterministic movement to a legal adjacent tile
  if (motivationKind === "random") {
    return buildRandomMoveProposals({ observation, payload, simConfig, personaSeed });
  }

  const hostile = resolveNearestHostile(view, actorId);

  if (hostile) {
    const adjacent = hostile.distance <= 1;

    // Adjacent hostile + attacking or defending → attack
    if (adjacent && (motivationKind === "attacking" || motivationKind === "defending")) {
      return [
        {
          kind: "attack",
          params: {
            targetId: hostile.actor.id,
            attackerPosition: { ...actor.position },
            targetPosition: { ...hostile.actor.position },
            damage: DEFAULT_ATTACK_DAMAGE,
          },
        },
      ];
    }

    // Non-adjacent + attacking → move toward hostile
    if (!adjacent && motivationKind === "attacking") {
      const baseTiles = resolveBaseTiles(payload, view, simConfig);
      const tileKinds = resolveTileKinds(view, payload);
      const path = findPath(actor.position, hostile.actor.position, tileKinds, baseTiles);
      if (path && path.length >= 2) {
        const from = path[0];
        const to = path[1];
        const delta = { dx: to.x - from.x, dy: to.y - from.y };
        const direction = DEFAULT_DELTAS.find(
          (e) => e.dx === delta.dx && e.dy === delta.dy,
        )?.direction;
        if (direction) {
          return [{ kind: "move", params: { direction, from, to } }];
        }
      }
    }

    // Non-adjacent + defending → hold position (no action)
    if (!adjacent && motivationKind === "defending") {
      return [];
    }
  }

  // Fallback: existing exit pathfinding
  return buildMoveProposal({ observation, payload, simConfig });
}

/**
 * @param {object} options
 * @param {(proposals: Array, budget: object) => Array} [options.admitProposals]
 *   The Allocator's budget-admissibility judge, wired in by the runner. CR.6: the
 *   Actor no longer OWNS this policy — it does not define it, cannot reach a
 *   different verdict than the Allocator, and refuses to guess if a budget shows up
 *   with no judge attached (see below).
 */
export function createActorPersona({ initialState = ActorStates.IDLE, clock, seed: personaSeed, admitProposals, from } = {}) {
  const fsm = createActorStateMachine({ initialState, clock, from });
  // CR.6 — this persona holds NO state outside `fsm`. It used to cache
  // lastObservation / lastBaseTiles / lastSimConfig / lastAffinityEffects /
  // lastHazards here; none appeared in view(), so two Actors with identical
  // serialized views could decide differently, which is an A4 violation and
  // breaks deterministic replay. The decision is now a pure function of
  // (fsm state, event, payload) — everything decision-relevant arrives in the
  // payload, and everything carried is in view().
  //
  // Measured before removing: across the whole suite the caches were read 430
  // times and EVERY read came from a direct persona-test caller — none through
  // the runner, which supplies observation/baseTiles/simConfig/affinityEffects on
  // every DECIDE payload and never supplies `hazards` at all.

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!actorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const observation = resolveObservation(payload);
    const observationView = resolveObservationView(observation);
    const simConfig = payload.simConfig || null;
    const baseTiles = resolveBaseTiles(payload, observationView, simConfig);

    const shouldEmitActions = event === "propose";
    const derivedProposals = shouldEmitActions ? buildMotivatedProposals({ observation, payload: { ...payload, tick }, simConfig, personaSeed }) : [];
    // CR.6 — the Actor derives CANDIDATE proposals. Budget admissibility used to
    // be decided here by a local filterBudgetedProposals; the policy now lives in
    // personas/allocator/proposal-admissibility.js and reaches the Actor only as
    // the Allocator's own injected judge, wired by the runner.
    const candidates = shouldEmitActions
      ? (Array.isArray(payload.proposals) && payload.proposals.length > 0 ? payload.proposals : derivedProposals)
      : [];
    const budgetReceipt = payload.budgetReceipt || payload.budget?.receipt || payload.budget?.receiptArtifact || null;
    const budgetAllocation = payload.budgetAllocation || payload.budget?.allocation || null;
    const hasBudget = Boolean(budgetReceipt || budgetAllocation);
    if (hasBudget && typeof admitProposals !== "function") {
      // A budget arrived with nothing authorised to judge it. Silently admitting
      // everything is exactly the quiet degradation this program keeps removing
      // (PX.3's D-o: required and throwing, never a permissive default).
      const error = new Error(
        "Actor received a budget but no Allocator admissibility judge: budget admissibility is "
        + "Allocator policy (CR.6). Construct the Actor with `admitProposals` from the Allocator.",
      );
      error.code = "actor_admissibility_required";
      throw error;
    }
    const candidateProposals = hasBudget
      ? admitProposals(candidates, { budgetReceipt, budgetAllocation })
      : candidates;
    const exit = resolveExit(payload, observationView, baseTiles, simConfig);
    const runtimeDecisionEffect = shouldEmitActions
      ? buildRuntimeDecisionEffect({
          payload: {
            ...payload,
            proposals: candidateProposals,
            affinityEffects: payload.affinityEffects,
            hazards: payload.hazards,
            clock,
          },
          observation,
          view: observationView,
          actorId: payload.actorId || observation?.actorId || "actor",
          tick,
          baseTiles,
          exit,
        })
      : null;
    if (shouldEmitActions && (!Array.isArray(candidateProposals) || candidateProposals.length === 0) && !runtimeDecisionEffect) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }

    const fsmPayload = shouldEmitActions && Array.isArray(candidateProposals) ? { ...payload, proposals: candidateProposals } : payload;
    const result = fsm.advance(event, fsmPayload);
    if (!shouldEmitActions) {
      return { ...result, tick, actions: [], effects: [], telemetry: null };
    }

    const baseActorId = payload.actorId || observation?.actorId || "actor";
    const baseIsMotivated = isMotivatedActor(baseActorId, observationView, observation);
    const actions = [];
    const effects = [];
    const proposalList = Array.isArray(candidateProposals) ? candidateProposals : [];
    if (!runtimeDecisionEffect) {
      for (let i = 0; i < proposalList.length; i += 1) {
        const proposal = proposalList[i];
        const proposalActorId = proposal.actorId || baseActorId;
        if (!isMotivatedActor(proposalActorId, observationView, observation)) {
          continue;
        }
        actions.push(
          buildAction({
            tick,
            kind: proposal.kind || "custom",
            actorId: proposalActorId,
            personaRef: "actor",
            params: proposal.params || proposal,
          }),
        );
      }
    } else {
      effects.push(runtimeDecisionEffect.solverEffect);
      result.context = {
        ...result.context,
        lastSolverRequest: runtimeDecisionEffect.solverEffect.request,
        lastRuntimeDecisionEnvelope: runtimeDecisionEffect.envelope,
      };
    }

    const log = payload.trace;
    if (log && baseIsMotivated) {
      actions.push(
        buildAction({
          tick,
          kind: "emit_log",
          actorId: baseActorId,
          personaRef: "actor",
          params: { severity: log.severity || "info", message: log.message || "actor_log" },
        }),
      );
    }

    if (payload.telemetry && baseIsMotivated) {
      actions.push(
        buildAction({
          tick,
          kind: "emit_telemetry",
          actorId: baseActorId,
          personaRef: "actor",
          params: { data: payload.telemetry },
        }),
      );
    }

    if (baseIsMotivated) {
      const fromEffects = buildRequestActionsFromEffects(payload.effects, {
        tick,
        personaRef: "actor",
        actorId: baseActorId,
        budgetRemaining: typeof payload?.budget?.effects === "number" ? payload.budget.effects : Number.MAX_SAFE_INTEGER,
      });
      actions.push(...fromEffects.actions);
    }

    return {
      ...result,
      tick,
      actions,
      effects,
      telemetry: null,
    };
  }

  return {
    subscribePhases: actorSubscribePhases,
    advance,
    view,
  };
}
