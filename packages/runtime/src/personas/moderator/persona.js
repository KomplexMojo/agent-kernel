import { createModeratorStateMachine, ModeratorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";

export const moderatorSubscribePhases = Object.freeze([
  TickPhases.INIT,
  TickPhases.OBSERVE,
  TickPhases.DECIDE,
  TickPhases.APPLY,
  TickPhases.EMIT,
  TickPhases.SUMMARIZE,
]);

export function createModeratorPersona({ initialState = ModeratorStates.INITIALIZING, clock = () => new Date().toISOString() } = {}) {
  const fsm = createModeratorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!moderatorSubscribePhases.includes(phase) || !event) {
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
    subscribePhases: moderatorSubscribePhases,
    advance,
    view,
  };
}
