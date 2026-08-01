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

export type TickPhase = (typeof TickPhases)[keyof typeof TickPhases];
export type TickEvent = "observe" | "decide" | "apply" | "emit" | "summarize" | "next_tick";

type TickTransition = {
  from: TickPhase;
  event: TickEvent;
  to: TickPhase;
  advanceTick?: boolean;
};

type TickContext = {
  tick: number;
  phase: TickPhase;
  lastEvent: TickEvent | null;
  updatedAt: string;
  notes: unknown;
};

type TickTransitionLog = {
  kind: "tick_transition";
  from: TickPhase;
  to: TickPhase;
  event: TickEvent;
  tick: number;
  timestamp: string;
};

export const TickPhaseList: TickPhase[] = Object.values(TickPhases);

const transitions: TickTransition[] = [
  { from: TickPhases.INIT, event: "observe", to: TickPhases.OBSERVE },
  { from: TickPhases.OBSERVE, event: "decide", to: TickPhases.DECIDE },
  { from: TickPhases.DECIDE, event: "apply", to: TickPhases.APPLY },
  { from: TickPhases.APPLY, event: "emit", to: TickPhases.EMIT },
  { from: TickPhases.EMIT, event: "summarize", to: TickPhases.SUMMARIZE },
  { from: TickPhases.SUMMARIZE, event: "next_tick", to: TickPhases.OBSERVE, advanceTick: true },
];

function findTransition(fromState: TickPhase, event: TickEvent) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

function allowedEventsFor(state: TickPhase) {
  return transitions.filter((entry) => entry.from === state).map((entry) => entry.event);
}

export function createTickStateMachine({
  initialState = TickPhases.INIT,
  clock = () => new Date().toISOString(),
  debug = false,
  logger = null,
}: {
  initialState?: TickPhase;
  clock?: () => string;
  debug?: boolean;
  logger?: ((entry: TickTransitionLog) => void) | null;
} = {}) {
  let state = initialState;
  let tick = 0;
  let context: TickContext = {
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

  function advance(event: TickEvent, payload: { notes?: unknown } = {}) {
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
