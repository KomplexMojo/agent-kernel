// Deterministic state machine for the Moderator persona.
// Owns tick execution lifecycle bookkeeping without IO.

export const ModeratorStates = Object.freeze({
  INITIALIZING: "initializing",
  TICKING: "ticking",
  PAUSING: "pausing",
  STOPPING: "stopping",
});

const transitions = [
  { from: ModeratorStates.INITIALIZING, event: "start", to: ModeratorStates.TICKING },
  { from: ModeratorStates.TICKING, event: "pause", to: ModeratorStates.PAUSING },
  { from: ModeratorStates.PAUSING, event: "resume", to: ModeratorStates.TICKING },
  { from: ModeratorStates.TICKING, event: "stop", to: ModeratorStates.STOPPING },
  { from: ModeratorStates.PAUSING, event: "stop", to: ModeratorStates.STOPPING },
];

function allowedEvents(state) {
  return transitions.filter((t) => t.from === state).map((t) => t.event);
}

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

export function createModeratorStateMachine({ initialState = ModeratorStates.INITIALIZING, clock = () => new Date().toISOString() } = {}) {
  let state = initialState;
  let context = {
    lastEvent: null,
    updatedAt: clock(),
  };

  function view() {
    return { state, context: { ...context } };
  }

  function advance(event, payload = {}) {
    const transition = findTransition(state, event);
    if (!transition) {
      throw new Error(`No transition for state=${state} event=${event}; allowed events: ${allowedEvents(state).join(",") || "none"}`);
    }

    const nextState = transition.to;
    const nextContext = {
      ...context,
      lastEvent: event,
      updatedAt: clock(),
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

export const moderatorTransitions = transitions.slice();
