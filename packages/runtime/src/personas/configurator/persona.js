import { createConfiguratorStateMachine, ConfiguratorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";

export const configuratorSubscribePhases = Object.freeze([TickPhases.INIT, TickPhases.OBSERVE]);

export function createConfiguratorPersona({ initialState = ConfiguratorStates.UNINITIALIZED, clock = () => new Date().toISOString() } = {}) {
  const fsm = createConfiguratorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!configuratorSubscribePhases.includes(phase) || !event) {
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
    subscribePhases: configuratorSubscribePhases,
    advance,
    view,
  };
}
