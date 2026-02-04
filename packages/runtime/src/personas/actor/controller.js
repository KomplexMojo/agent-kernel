import { createActorStateMachine, ActorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";
import { buildAction, buildRequestActionsFromEffects } from "../_shared/persona-helpers.js";

export const actorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE]);

const DEFAULT_DELTAS = Object.freeze([
  { dx: 0, dy: -1, direction: "north" },
  { dx: 1, dy: 0, direction: "east" },
  { dx: 0, dy: 1, direction: "south" },
  { dx: -1, dy: 0, direction: "west" },
]);

const MOTIVATED_KIND = 2;

const AFFINITY_EXPRESSION_IDS = Object.freeze({
  push: "affinity_expression_externalize",
  pull: "affinity_expression_internalize",
  emit: "affinity_expression_localized",
});

const MOTIVATION_IDS = Object.freeze({
  reflexive: "motivation_reflexive",
  goal_oriented: "motivation_goal_oriented",
  strategy_focused: "motivation_strategy_focused",
});

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

function resolveTileKinds(view, payload) {
  if (Array.isArray(view?.tiles?.kinds)) return view.tiles.kinds;
  if (Array.isArray(view?.kinds)) return view.kinds;
  if (Array.isArray(payload?.tiles?.kinds)) return payload.tiles.kinds;
  return null;
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
      if (!isPassable(next, tileKinds, baseTiles)) {
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

    const shouldEmitActions = event === "propose";
    const derivedProposals = shouldEmitActions ? buildMoveProposal({ observation, payload, lastBaseTiles, lastSimConfig }) : [];
    const proposals = Array.isArray(payload.proposals) && payload.proposals.length > 0 ? payload.proposals : derivedProposals;
    const budgetReceipt = payload.budgetReceipt || payload.budget?.receipt || payload.budget?.receiptArtifact || null;
    const budgetAllocation = payload.budgetAllocation || payload.budget?.allocation || null;
    const gatedProposals = shouldEmitActions ? filterBudgetedProposals(proposals, { budgetReceipt, budgetAllocation }) : [];
    if (shouldEmitActions && (!Array.isArray(gatedProposals) || gatedProposals.length === 0)) {
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
    const proposalList = Array.isArray(gatedProposals) ? gatedProposals : [];
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
      effects: [],
      telemetry: null,
    };
  }

  return {
    subscribePhases: actorSubscribePhases,
    advance,
    view,
  };
}
