import { createOrchestratorStateMachine, OrchestratorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";

export const orchestratorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE, TickPhases.EMIT]);

export function createOrchestratorPersona({ initialState = OrchestratorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  const fsm = createOrchestratorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!orchestratorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    return {
      ...result,
      tick,
      actions: [],
      effects: [],
      telemetry: null,
    };
  }

  return {
    subscribePhases: orchestratorSubscribePhases,
    advance,
    view,
  };
}
