// Deterministic state machine for the Annotator persona.
// Captures observations and summarizes telemetry without IO.

export const AnnotatorStates = Object.freeze({
  IDLE: "idle",
  RECORDING: "recording",
  SUMMARIZING: "summarizing",
});

const transitions = [
  { from: AnnotatorStates.IDLE, event: "observe", to: AnnotatorStates.RECORDING },
  {
    from: AnnotatorStates.RECORDING,
    event: "summarize",
    to: AnnotatorStates.SUMMARIZING,
    guard: hasObservations,
  },
  { from: AnnotatorStates.SUMMARIZING, event: "reset", to: AnnotatorStates.IDLE },
];

function hasObservations(payload = {}) {
  const observations = payload.observations;
  return Array.isArray(observations) && observations.length > 0;
}

function allowedEvents(state) {
  return transitions.filter((t) => t.from === state).map((t) => t.event);
}

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

export function createAnnotatorStateMachine({ initialState = AnnotatorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  let state = initialState;
  let context = {
    lastEvent: null,
    updatedAt: clock(),
    lastObservationCount: 0,
  };

  function view() {
    return { state, context: { ...context } };
  }

  function advance(event, payload = {}) {
    const transition = findTransition(state, event);
    if (!transition) {
      throw new Error(`No transition for state=${state} event=${event}; allowed events: ${allowedEvents(state).join(",") || "none"}`);
    }
    if (transition.guard && !transition.guard(payload, { state, context })) {
      throw new Error(`Guard blocked transition for state=${state} event=${event}`);
    }

    const nextState = transition.to;
    const nextContext = {
      ...context,
      lastEvent: event,
      updatedAt: clock(),
      lastObservationCount: Array.isArray(payload.observations) ? payload.observations.length : context.lastObservationCount,
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

export const annotatorTransitions = transitions.slice();
