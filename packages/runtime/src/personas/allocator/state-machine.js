// Deterministic state machine for the Allocator persona.
// Manages budgeting loop without performing IO.

import { requireClock } from "../_shared/require-clock.js";
import { restorePersonaView } from "../_shared/restore-view.js";

export const AllocatorStates = Object.freeze({
  IDLE: "idle",
  BUDGETING: "budgeting",
  ALLOCATING: "allocating",
  MONITORING: "monitoring",
  REBALANCING: "rebalancing",
});

// PX.5 — TWO VOCABULARIES, ONE FSM, kept distinct.
//
// BUILD plane: budget → allocate. allocator-services.js drives these —
// registerBudget sends `budget`, validateSpend sends `allocate` — and reaching
// `budgeting`/`allocating` is a claim that a budget was registered and a spend
// validated. The tick plane used to send them directly, so a run reported
// `allocating` with budgetTokens null and receiptCount 0: a state asserting work
// that never happened.
//
// TICK plane: observe · monitor → rebalance. These have NO service-method
// counterpart, so they claim nothing about build-plane work — they are the
// Allocator's own runtime loop, driven by runtime signals. `monitor` may now also be
// entered from IDLE, so the tick plane can reach its loop without first pretending
// to run a budget round.
//
// `observe` is a state-preserving self-loop, because the tick plane must be able to
// give the Allocator a round on every phase: its advance() turns payload effects into
// budget-limited request actions and emits solver/external-fact requests, which the
// runner consumes (runtime-fsm.mjs handles request_solver and request_external_fact).
// That work is entirely payload-driven — the event is a ticket to run — so a
// self-loop serves it without moving the state.
export const ALLOCATOR_TICK_EVENT = "observe";

const transitions = [
  ...Object.values(AllocatorStates).map((state) => ({
    from: state,
    event: ALLOCATOR_TICK_EVENT,
    to: state,
  })),
  { from: AllocatorStates.IDLE, event: "monitor", to: AllocatorStates.MONITORING },
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

export function createAllocatorStateMachine({ initialState = AllocatorStates.IDLE, clock, from } = {}) {
  requireClock(clock, "allocator");
  const restored = restorePersonaView(from, {
    persona: "allocator",
    states: Object.values(AllocatorStates),
  });
  let state = restored?.state ?? initialState;
  let context = restored?.context ?? {
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
