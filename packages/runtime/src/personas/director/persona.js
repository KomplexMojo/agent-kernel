import { createDirectorStateMachine, DirectorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";
import { buildSolverRequestEffect } from "../_shared/persona-helpers.js";

// Phases this persona listens to (others are ignored).
export const directorSubscribePhases = Object.freeze([TickPhases.DECIDE]);

// Phase-aware Director persona wrapper. Pure/deterministic; no IO.
export function createDirectorPersona({ initialState = DirectorStates.UNINITIALIZED, clock = () => new Date().toISOString() } = {}) {
  const fsm = createDirectorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!directorSubscribePhases.includes(phase)) {
      const snapshot = view();
      return { ...snapshot, actions: [], effects: [], telemetry: null };
    }
    if (!event) {
      const snapshot = view();
      return { ...snapshot, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    const effects = [];
    const solverEffect = buildSolverRequestEffect({
      solverRequest: payload.solver || payload.solverRequest,
      intentRef: payload.intentRef,
      planRef: payload.planRef,
      personaRef: "director",
      targetAdapter: payload.targetAdapter,
    });
    if (solverEffect) {
      effects.push(solverEffect);
      result.context = { ...result.context, lastSolverRequest: solverEffect.request };
    }
    return {
      ...result,
      tick,
      actions: [],
      effects,
      telemetry: null,
    };
  }

  return {
    advance,
    view,
    subscribePhases: directorSubscribePhases,
  };
}
