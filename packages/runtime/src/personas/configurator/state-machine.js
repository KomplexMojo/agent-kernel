// Deterministic state machine for the Configurator persona.
// Manages configuration lifecycle without IO.

export const ConfiguratorStates = Object.freeze({
  UNINITIALIZED: "uninitialized",
  PENDING_CONFIG: "pending_config",
  CONFIGURED: "configured",
  LOCKED: "locked",
});

const transitions = [
  {
    from: ConfiguratorStates.UNINITIALIZED,
    event: "provide_config",
    to: ConfiguratorStates.PENDING_CONFIG,
    guard: hasConfig,
  },
  {
    from: ConfiguratorStates.PENDING_CONFIG,
    event: "validate",
    to: ConfiguratorStates.CONFIGURED,
    guard: hasConfig,
  },
  { from: ConfiguratorStates.CONFIGURED, event: "lock", to: ConfiguratorStates.LOCKED },
  {
    from: ConfiguratorStates.CONFIGURED,
    event: "update_config",
    to: ConfiguratorStates.PENDING_CONFIG,
    guard: hasConfig,
  },
];

function hasConfig(payload = {}) {
  const config = payload.config;
  return config && typeof config === "object";
}

function allowedEvents(state) {
  return transitions.filter((t) => t.from === state).map((t) => t.event);
}

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

export function createConfiguratorStateMachine({ initialState = ConfiguratorStates.UNINITIALIZED, clock = () => new Date().toISOString() } = {}) {
  let state = initialState;
  let context = {
    lastEvent: null,
    updatedAt: clock(),
    lastConfigRef: null,
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
      lastConfigRef: payload.configRef ?? context.lastConfigRef,
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

export const configuratorTransitions = transitions.slice();
