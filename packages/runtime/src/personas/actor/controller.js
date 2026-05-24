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

const AFFINITY_EXPRESSION_IDS = Object.freeze({
  push: "affinity_expression_externalize",
  pull: "affinity_expression_internalize",
  emit: "affinity_expression_localized",
  draw: "affinity_expression_sustain",
});

const MOTIVATION_IDS = Object.freeze({
  reflexive: "motivation_reflexive",
  goal_oriented: "motivation_goal_oriented",
  strategy_focused: "motivation_strategy_focused",
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMotivatedKind(kind) {
  if (typeof kind === "number") return kind === MOTIVATED_KIND;
  if (typeof kind === "string") return kind.toLowerCase() === "motivated";
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

function normalizeMotivationTier(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]/g, "_");
  if (normalized === "random") return "reflexive";
  if (normalized === "logical") return "goal_oriented";
  if (normalized === "strategic") return "strategy_focused";
  if (normalized === "goal_oriented") return "goal_oriented";
  if (normalized === "strategy_focused") return "strategy_focused";
  if (normalized === "reflexive") return "reflexive";
  return null;
}

function resolveMotivationId(proposal) {
  if (!proposal || typeof proposal !== "object") return null;
  if (proposal.costKind === "motivation" && typeof proposal.costId === "string") {
    return proposal.costId;
  }
  if (proposal.budget?.kind === "motivation" && typeof proposal.budget?.id === "string") {
    return proposal.budget.id;
  }
  if (typeof proposal.kind === "string" && proposal.kind.startsWith("motivation_")) {
    return proposal.kind;
  }
  if (proposal.kind !== "motivation") {
    return null;
  }
  const tier = normalizeMotivationTier(proposal.tier || proposal.motivation || proposal.level || proposal.kind);
  return tier ? MOTIVATION_IDS[tier] : null;
}

function resolveAffinityExpressionId(proposal) {
  if (!proposal || typeof proposal !== "object") return null;
  if (proposal.costKind === "affinity" && typeof proposal.costId === "string") {
    return proposal.costId;
  }
  if (proposal.budget?.kind === "affinity" && typeof proposal.budget?.id === "string") {
    return proposal.budget.id;
  }
  if (typeof proposal.kind === "string" && proposal.kind.startsWith("affinity_expression_")) {
    return proposal.kind;
  }
  if (proposal.kind !== "affinity") {
    return null;
  }
  const expression = proposal.expression || proposal.affinityExpression || proposal.affinity?.expression;
  if (!expression) return null;
  return AFFINITY_EXPRESSION_IDS[String(expression).trim().toLowerCase()] || null;
}

function hasBudgetAllowance({ budgetAllocation, budgetReceipt, kind, id }) {
  if (!budgetAllocation && !budgetReceipt) return true;
  if (budgetAllocation) {
    const pools = Array.isArray(budgetAllocation.pools) ? budgetAllocation.pools : [];
    const pool = pools.find((entry) => entry?.id === "affinity_motivation");
    if (pool && Number.isInteger(pool.tokens) && pool.tokens <= 0) {
      return false;
    }
  }
  if (!budgetReceipt) return true;
  const lineItems = Array.isArray(budgetReceipt.lineItems) ? budgetReceipt.lineItems : [];
  const matches = lineItems.filter((item) => item?.kind === kind && item?.id === id);
  if (matches.length === 0) {
    return false;
  }
  return matches.some((item) => item.status !== "denied" && Number.isInteger(item.quantity) && item.quantity > 0);
}

function filterBudgetedProposals(proposals, { budgetReceipt, budgetAllocation } = {}) {
  if (!budgetReceipt && !budgetAllocation) return proposals;
  return proposals.filter((proposal) => {
    const motivationId = resolveMotivationId(proposal);
    if (motivationId) {
      return hasBudgetAllowance({ budgetAllocation, budgetReceipt, kind: "motivation", id: motivationId });
    }
    const affinityExpressionId = resolveAffinityExpressionId(proposal);
    if (affinityExpressionId) {
      const expressionAllowed = hasBudgetAllowance({
        budgetAllocation,
        budgetReceipt,
        kind: "affinity",
        id: affinityExpressionId,
      });
      if (!expressionAllowed) return false;
      return hasBudgetAllowance({ budgetAllocation, budgetReceipt, kind: "affinity", id: "affinity_stack" });
    }
    return true;
  });
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

function resolveObservation(payload, lastObservation) {
  if (payload?.observation) return payload.observation;
  if (Array.isArray(payload?.observations) && payload.observations.length > 0) {
    return payload.observations[0];
  }
  if (payload?.view) return payload.view;
  return lastObservation || null;
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

function resolveBaseTiles(payload, view, lastBaseTiles, lastSimConfig) {
  const fromPayload = payload?.baseTiles || payload?.tiles?.baseTiles;
  if (fromPayload) return fromPayload;
  if (view?.baseTiles) return view.baseTiles;
  if (view?.tiles?.baseTiles) return view.tiles.baseTiles;
  if (view?.tiles?.tiles) return view.tiles.tiles;
  if (lastBaseTiles) return lastBaseTiles;
  const simConfig = payload?.simConfig || lastSimConfig;
  if (simConfig?.layout?.data?.tiles) return simConfig.layout.data.tiles;
  return null;
}

function resolveExit(payload, view, baseTiles, lastSimConfig) {
  if (payload?.exit) return payload.exit;
  if (view?.exit) return view.exit;
  const simConfig = payload?.simConfig || lastSimConfig;
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

  function addHazard(entry, fallbackKind = "hazard") {
    if (!entry || typeof entry !== "object") return;
    const position = isObject(entry.position)
      ? { ...entry.position }
      : Number.isFinite(entry.x) && Number.isFinite(entry.y)
        ? { x: entry.x, y: entry.y }
        : null;
    if (!position) return;
    const kind = typeof entry.kind === "string" && entry.kind.trim() ? entry.kind.trim() : fallbackKind;
    const id = typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : `${kind}_${position.x}_${position.y}`;
    const key = `${id}:${position.x}:${position.y}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const next = { id, kind, position };
    if (typeof entry.expression === "string" && entry.expression.trim()) next.expression = entry.expression.trim();
    if (typeof entry.affinity === "string" && entry.affinity.trim()) next.affinity = entry.affinity.trim();
    if (Number.isFinite(entry.stacks)) next.stacks = Math.max(1, Math.trunc(entry.stacks));
    hazards.push(next);
  }

  const affinityTraps = Array.isArray(payload?.affinityEffects?.traps) ? payload.affinityEffects.traps : [];
  affinityTraps.forEach((entry) => addHazard(entry, "trap"));

  const viewTraps = Array.isArray(view?.traps) ? view.traps : [];
  viewTraps.forEach((entry) => addHazard(entry, "trap"));

  const explicitHazards = Array.isArray(payload?.hazards) ? payload.hazards : [];
  explicitHazards.forEach((entry) => addHazard(entry, "hazard"));

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

function buildMoveProposal({ observation, payload, lastBaseTiles, lastSimConfig }) {
  const view = resolveObservationView(observation);
  if (!view) return [];
  const baseTiles = resolveBaseTiles(payload, view, lastBaseTiles, lastSimConfig);
  const exit = resolveExit(payload, view, baseTiles, lastSimConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const actor = resolveActor(view, payload?.actorId, observation);
  if (!actor || !actor.position || !exit) return [];
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

export function createActorPersona({ initialState = ActorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  const fsm = createActorStateMachine({ initialState, clock });
  let lastObservation = null;
  let lastBaseTiles = null;
  let lastSimConfig = null;
  let lastAffinityEffects = null;
  let lastHazards = null;

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!actorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const observation = resolveObservation(payload, lastObservation);
    if (observation) {
      lastObservation = observation;
    }
    const observationView = resolveObservationView(observation);
    const baseTiles = resolveBaseTiles(payload, observationView, lastBaseTiles, lastSimConfig);
    if (baseTiles) {
      lastBaseTiles = baseTiles;
    }
    if (payload.simConfig) {
      lastSimConfig = payload.simConfig;
    }
    if (payload.affinityEffects) {
      lastAffinityEffects = payload.affinityEffects;
    }
    if (Array.isArray(payload.hazards)) {
      lastHazards = payload.hazards;
    }

    const shouldEmitActions = event === "propose";
    const derivedProposals = shouldEmitActions ? buildMoveProposal({ observation, payload, lastBaseTiles, lastSimConfig }) : [];
    const proposals = Array.isArray(payload.proposals) && payload.proposals.length > 0 ? payload.proposals : derivedProposals;
    const budgetReceipt = payload.budgetReceipt || payload.budget?.receipt || payload.budget?.receiptArtifact || null;
    const budgetAllocation = payload.budgetAllocation || payload.budget?.allocation || null;
    const gatedProposals = shouldEmitActions ? filterBudgetedProposals(proposals, { budgetReceipt, budgetAllocation }) : [];
    const exit = resolveExit(payload, observationView, lastBaseTiles, lastSimConfig);
    const runtimeDecisionEffect = shouldEmitActions
      ? buildRuntimeDecisionEffect({
          payload: {
            ...payload,
            proposals: gatedProposals,
            affinityEffects: payload.affinityEffects || lastAffinityEffects,
            hazards: payload.hazards || lastHazards,
            clock,
          },
          observation,
          view: observationView,
          actorId: payload.actorId || observation?.actorId || "actor",
          tick,
          baseTiles: lastBaseTiles,
          exit,
        })
      : null;
    if (shouldEmitActions && (!Array.isArray(gatedProposals) || gatedProposals.length === 0) && !runtimeDecisionEffect) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }

    const fsmPayload = shouldEmitActions && Array.isArray(gatedProposals) ? { ...payload, proposals: gatedProposals } : payload;
    const result = fsm.advance(event, fsmPayload);
    if (!shouldEmitActions) {
      return { ...result, tick, actions: [], effects: [], telemetry: null };
    }

    const baseActorId = payload.actorId || observation?.actorId || "actor";
    const baseIsMotivated = isMotivatedActor(baseActorId, observationView, observation);
    const actions = [];
    const effects = [];
    const proposalList = Array.isArray(gatedProposals) ? gatedProposals : [];
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
