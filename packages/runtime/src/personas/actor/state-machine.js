// Deterministic state machine for the Actor persona.
// Handles observation -> decision -> proposing loop without IO.

import { requireClock } from "../_shared/require-clock.js";
import { restorePersonaView } from "../_shared/restore-view.js";

export const ActorStates = Object.freeze({
  IDLE: "idle",
  OBSERVING: "observing",
  DECIDING: "deciding",
  PROPOSING: "proposing",
  COOLDOWN: "cooldown",
});

const transitions = [
  { from: ActorStates.IDLE, event: "observe", to: ActorStates.OBSERVING },
  { from: ActorStates.OBSERVING, event: "decide", to: ActorStates.DECIDING },
  {
    from: ActorStates.DECIDING,
    event: "propose",
    to: ActorStates.PROPOSING,
    guard: hasProposals,
  },
  { from: ActorStates.DECIDING, event: "cooldown", to: ActorStates.COOLDOWN },
  { from: ActorStates.PROPOSING, event: "cooldown", to: ActorStates.COOLDOWN },
  { from: ActorStates.COOLDOWN, event: "observe", to: ActorStates.OBSERVING },
];

function hasProposals(payload = {}) {
  const proposals = payload.proposals;
  return Array.isArray(proposals) && proposals.length > 0;
}

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

export function createActorStateMachine({ initialState = ActorStates.IDLE, clock, from } = {}) {
  requireClock(clock, "actor");
  const restored = restorePersonaView(from, {
    persona: "actor",
    states: Object.values(ActorStates),
  });
  let state = restored?.state ?? initialState;
  let context = restored?.context ?? {
    lastEvent: null,
    updatedAt: clock(),
    lastProposalCount: 0,
  };

  function view() {
    const copy = { ...context };
    if (context.strategies) copy.strategies = structuredClone(context.strategies);
    if (context.cognition) copy.cognition = structuredClone(context.cognition);
    if (context.escorts) copy.escorts = structuredClone(context.escorts);
    if (context.moves) copy.moves = structuredClone(context.moves);
    if (context.contacts) copy.contacts = structuredClone(context.contacts);
    return { state, context: copy };
  }

  function advance(event, payload = {}) {
    const transition = findTransition(state, event);
    if (!transition) {
      const allowed = transitions.filter((t) => t.from === state).map((t) => t.event);
      throw new Error(`No transition for state=${state} event=${event}; allowed events: ${allowed.join(",") || "none"}`);
    }
    if (transition.guard && !transition.guard(payload, { state, context })) {
      throw new Error(`Guard blocked transition for state=${state} event=${event}`);
    }

    const nextState = transition.to;
    const nextContext = {
      ...context,
      lastEvent: event,
      updatedAt: clock(),
      lastProposalCount: Array.isArray(payload.proposals) ? payload.proposals.length : context.lastProposalCount,
    };
    // Strategy progress, per actor (Phase 2b): which goal each is on and how it is going.
    // Plain data, so the whole Actor stays serializable; absent until an actor has a strategy.
    const strategyEntry = payload.strategyEntry;
    if (strategyEntry && typeof strategyEntry.actorId === "string" && strategyEntry.actorId) {
      nextContext.strategies = { ...(context.strategies || {}), [strategyEntry.actorId]: structuredClone(strategyEntry.entry) };
    }
    // #308 — the goal a thinking actor adopted on its own (no order, no level strategy).
    // Kept apart from `strategies`, which hold only what someone ordered or authored.
    const cognitionEntry = payload.cognitionEntry;
    if (cognitionEntry && typeof cognitionEntry.actorId === "string" && cognitionEntry.actorId) {
      nextContext.cognition = { ...(context.cognition || {}), [cognitionEntry.actorId]: structuredClone(cognitionEntry.entry) };
    }
    // #251 — an escort's follow progress (where it last saw its ally), per actor.
    const escortEntry = payload.escortEntry;
    if (escortEntry && typeof escortEntry.actorId === "string" && escortEntry.actorId) {
      nextContext.escorts = { ...(context.escorts || {}), [escortEntry.actorId]: structuredClone(escortEntry.entry) };
    }

    // #457 — per actor, where its last proposed move was proposed from (null: it proposed none).
    const moveEntry = payload.moveEntry;
    if (moveEntry && typeof moveEntry.actorId === "string" && moveEntry.actorId) {
      const moves = { ...(context.moves || {}) };
      if (moveEntry.entry) moves[moveEntry.actorId] = structuredClone(moveEntry.entry);
      else delete moves[moveEntry.actorId];
      if (Object.keys(moves).length > 0) nextContext.moves = moves;
      else delete nextContext.moves;
    }

    // #516 — per actor, where it last saw a hostile (null: it has none to pursue).
    const contactEntry = payload.contactEntry;
    if (contactEntry && typeof contactEntry.actorId === "string" && contactEntry.actorId) {
      const contacts = { ...(context.contacts || {}) };
      if (contactEntry.entry) contacts[contactEntry.actorId] = structuredClone(contactEntry.entry);
      else delete contacts[contactEntry.actorId];
      if (Object.keys(contacts).length > 0) nextContext.contacts = contacts;
      else delete nextContext.contacts;
    }

    state = nextState;
    context = nextContext;

    return {
      state,
      context: view().context,
    };
  }

  return {
    advance,
    view,
  };
}

export const actorTransitions = transitions.slice();
