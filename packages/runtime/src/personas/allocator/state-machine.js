// Deterministic state machine for the Allocator persona.
// Manages budgeting loop without performing IO.

export const AllocatorStates = Object.freeze({
  IDLE: "idle",
  BUDGETING: "budgeting",
  ALLOCATING: "allocating",
  MONITORING: "monitoring",
  REBALANCING: "rebalancing",
});

const transitions = [
  { from: AllocatorStates.IDLE, event: "budget", to: AllocatorStates.BUDGETING },
  {
    from: AllocatorStates.BUDGETING,
    event: "allocate",
    to: AllocatorStates.ALLOCATING,
    guard: hasBudgets,
  },
  { from: AllocatorStates.ALLOCATING, event: "monitor", to: AllocatorStates.MONITORING },
  {
    from: AllocatorStates.MONITORING,
    event: "rebalance",
    to: AllocatorStates.REBALANCING,
    guard: hasRebalanceSignals,
  },
  { from: AllocatorStates.REBALANCING, event: "monitor", to: AllocatorStates.MONITORING },
];

function hasBudgets(payload = {}) {
  const budgets = payload.budgets;
  return Array.isArray(budgets) && budgets.length > 0;
}

function hasRebalanceSignals(payload = {}) {
  const signals = payload.signals;
  return Array.isArray(signals) && signals.length > 0;
}

function allowedEvents(state) {
  return transitions.filter((t) => t.from === state).map((t) => t.event);
}

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

export function createAllocatorStateMachine({ initialState = AllocatorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  let state = initialState;
  let context = {
    lastEvent: null,
    updatedAt: clock(),
    lastBudgetCount: 0,
    lastSignalCount: 0,
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
      lastBudgetCount: Array.isArray(payload.budgets) ? payload.budgets.length : context.lastBudgetCount,
      lastSignalCount: Array.isArray(payload.signals) ? payload.signals.length : context.lastSignalCount,
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

export const allocatorTransitions = transitions.slice();
