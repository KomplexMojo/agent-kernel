// Deterministic state machine for the Director persona.
// Handles plan/intent intake and refinement without performing IO.

export const DirectorStates = Object.freeze({
  UNINITIALIZED: "uninitialized",
  INTAKE: "intake",
  DRAFT_PLAN: "draft_plan",
  REFINE: "refine",
  READY: "ready",
  STALE: "stale",
});

// PX.5 — `observe` is the TICK-PLANE event: a state-preserving self-loop.
//
// Everything below is BUILD-plane vocabulary, driven by director-services.js:
// beginBuild sends bootstrap → ingest_intent, assembleBuildSpec sends
// draft_complete → refinement_complete. Reaching `ready` is therefore a claim that a
// build round completed. The tick plane used to send those same events directly, so
// a run reported `ready` with buildSpecCount 0 and planId null — and, worse, minted
// a PlanArtifact mid-run, which is build-plane work (IntentEnvelope → PlanArtifact →
// BuildSpec) leaking into a loop that should be consuming an already-built plan.
//
// The tick plane still needs a round so the Director's payload-driven output (solver
// effects, and a plan artifact when the payload carries one) can flow, so it now
// sends `observe`, which does that work without asserting a completed build round.
export const DIRECTOR_TICK_EVENT = "observe";

const transitions = [
  ...Object.values(DirectorStates).map((state) => ({
    from: state,
    event: DIRECTOR_TICK_EVENT,
    to: state,
  })),
  {
    from: DirectorStates.UNINITIALIZED,
    event: "bootstrap",
    to: DirectorStates.INTAKE,
    guard: hasIntentOrPlan,
  },
  {
    from: DirectorStates.INTAKE,
    event: "ingest_intent",
    to: DirectorStates.DRAFT_PLAN,
    guard: hasIntent,
  },
  {
    from: DirectorStates.INTAKE,
    event: "ingest_plan",
    to: DirectorStates.READY,
    guard: hasPlan,
  },
  {
    from: DirectorStates.DRAFT_PLAN,
    event: "draft_complete",
    to: DirectorStates.REFINE,
    guard: hasPlan,
  },
  {
    from: DirectorStates.REFINE,
    event: "refinement_complete",
    to: DirectorStates.READY,
    guard: hasPlan,
  },
  {
    from: DirectorStates.READY,
    event: "invalidate_plan",
    to: DirectorStates.STALE,
    guard: () => true,
  },
  {
    from: DirectorStates.STALE,
    event: "refresh",
    to: DirectorStates.INTAKE,
    guard: hasIntentOrPlan,
  },
];

function hasIntent(payload = {}) {
  return Boolean(payload.intentRef || payload.intentEnvelope);
}

function hasPlan(payload = {}) {
  return Boolean(payload.planRef || payload.planArtifact);
}

function hasIntentOrPlan(payload = {}) {
  return hasIntent(payload) || hasPlan(payload);
}

function findTransition(fromState, event) {
  return transitions.find((entry) => entry.from === fromState && entry.event === event);
}

export function createDirectorStateMachine({ initialState = DirectorStates.UNINITIALIZED, clock = () => new Date().toISOString() } = {}) {
  let state = initialState;
  let context = {
    intentRef: null,
    planRef: null,
    updatedAt: clock(),
    lastEvent: null,
  };

  function view() {
    return { state, context: { ...context } };
  }

  function advance(event, payload = {}) {
    const transition = findTransition(state, event);
    if (!transition) {
      throw new Error(`No transition for state=${state} event=${event}`);
    }
    if (transition.guard && !transition.guard(payload, { state, context })) {
      throw new Error(`Guard blocked transition for state=${state} event=${event}`);
    }

    const nextState = transition.to;
    const nextContext = {
      ...context,
      intentRef: payload.intentRef ?? context.intentRef,
      planRef: payload.planRef ?? context.planRef,
      updatedAt: clock(),
      lastEvent: event,
    };

    state = nextState;
    context = nextContext;

    return {
      state,
      context: view().context,
      actions: [],
      effects: [],
      telemetry: null,
    };
  }

  return {
    advance,
    view,
  };
}

export const directorTransitions = transitions.slice();
