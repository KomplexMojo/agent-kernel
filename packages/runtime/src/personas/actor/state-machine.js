// Deterministic state machine for the Actor persona.
// Handles observation -> decision -> proposing loop without IO.

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

export function createActorStateMachine({ initialState = ActorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  let state = initialState;
  let context = {
    lastEvent: null,
    updatedAt: clock(),
    lastProposalCount: 0,
  };

  function view() {
    return { state, context: { ...context } };
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
