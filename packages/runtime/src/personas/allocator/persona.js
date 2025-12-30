import { createAllocatorStateMachine, AllocatorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";

export const allocatorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE]);

export function createAllocatorPersona({ initialState = AllocatorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  const fsm = createAllocatorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!allocatorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    const effects = [];
    if (payload.solverRequest) {
      effects.push({ kind: "solver_request", request: payload.solverRequest });
      result.context = { ...result.context, lastSolverRequest: payload.solverRequest };
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
    subscribePhases: allocatorSubscribePhases,
    advance,
    view,
  };
}
