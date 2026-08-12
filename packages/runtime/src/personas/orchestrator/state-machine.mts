// Deterministic state machine for the Orchestrator persona.
// Coordinates workflow phases without IO.

export const OrchestratorStates = Object.freeze({
  IDLE: "idle",
  PLANNING: "planning",
  RUNNING: "running",
  REPLAYING: "replaying",
  COMPLETED: "completed",
  ERRORED: "errored",
});

const transitions = [
  { from: OrchestratorStates.IDLE, event: "plan", to: OrchestratorStates.PLANNING },
  {
    from: OrchestratorStates.PLANNING,
    event: "start_run",
    to: OrchestratorStates.RUNNING,
    guard: hasPlan,
  },
  { from: OrchestratorStates.RUNNING, event: "complete", to: OrchestratorStates.COMPLETED },
  { from: OrchestratorStates.RUNNING, event: "error", to: OrchestratorStates.ERRORED },
  { from: OrchestratorStates.RUNNING, event: "replay", to: OrchestratorStates.REPLAYING },
  { from: OrchestratorStates.REPLAYING, event: "complete", to: OrchestratorStates.COMPLETED },
  { from: OrchestratorStates.REPLAYING, event: "error", to: OrchestratorStates.ERRORED },
];

function hasPlan(payload = {}) {
  return Boolean(payload.planRef || payload.planArtifact);
}

function allowedEvents(state) {
  return transitions.filter((t) => t.from === state).map((t) => t.event);
}

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

export function createOrchestratorStateMachine({ initialState = OrchestratorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  let state = initialState;
  let context = {
    lastEvent: null,
    updatedAt: clock(),
    planRef: null,
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
      planRef: payload.planRef ?? context.planRef,
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

export const orchestratorTransitions = transitions.slice();
