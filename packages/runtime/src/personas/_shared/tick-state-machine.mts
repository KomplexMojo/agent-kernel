// Deterministic super FSM for tick phases.
// Phases describe the runtime loop; personas subscribe to phases.

export const TickPhases = Object.freeze({
  INIT: "init",
  OBSERVE: "observe",
  DECIDE: "decide",
  APPLY: "apply",
  EMIT: "emit",
  SUMMARIZE: "summarize",
});

export const TickPhaseList = Object.values(TickPhases);

const transitions = [
  { from: TickPhases.INIT, event: "observe", to: TickPhases.OBSERVE },
  { from: TickPhases.OBSERVE, event: "decide", to: TickPhases.DECIDE },
  { from: TickPhases.DECIDE, event: "apply", to: TickPhases.APPLY },
  { from: TickPhases.APPLY, event: "emit", to: TickPhases.EMIT },
  { from: TickPhases.EMIT, event: "summarize", to: TickPhases.SUMMARIZE },
  { from: TickPhases.SUMMARIZE, event: "next_tick", to: TickPhases.OBSERVE, advanceTick: true },
];

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

function allowedEventsFor(state) {
  return transitions.filter((entry) => entry.from === state).map((entry) => entry.event);
}

export function createTickStateMachine({
  initialState = TickPhases.INIT,
  clock = () => new Date().toISOString(),
  debug = false,
  logger = null,
} = {}) {
  let state = initialState;
  let tick = 0;
  let context = {
    tick,
    phase: state,
    lastEvent: null,
    updatedAt: clock(),
    notes: null,
  };

  function view() {
    return {
      state,
      context: { ...context },
      phase: state,
      tick,
    };
  }

  function advance(event, payload = {}) {
    const transition = findTransition(state, event);
    if (!transition) {
      const allowed = allowedEventsFor(state);
      throw new Error(`No transition for state=${state} event=${event}; allowed events: ${allowed.join(",") || "none"}`);
    }

    const nextTick = transition.advanceTick ? tick + 1 : tick;
    const nextState = transition.to;
    const nextContext = {
      ...context,
      tick: nextTick,
      phase: nextState,
      lastEvent: event,
      updatedAt: clock(),
      notes: payload.notes ?? context.notes ?? null,
    };

    state = nextState;
    tick = nextTick;
    context = nextContext;

    if (debug && typeof logger === "function") {
      logger({
        kind: "tick_transition",
        from: state,
        to: nextState,
        event,
        tick: nextTick,
        timestamp: context.updatedAt,
      });
    }

    return view();
  }

  return {
    advance,
    view,
  };
}

export const tickTransitions = transitions.slice();
