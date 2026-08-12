import { createModeratorStateMachine, ModeratorStates } from "./state-machine.mts";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { planModeratorAffinityActions } from "./affinity-target-effects.mts";

export const moderatorSubscribePhases = Object.freeze([
  TickPhases.INIT,
  TickPhases.OBSERVE,
  TickPhases.DECIDE,
  TickPhases.APPLY,
  TickPhases.EMIT,
  TickPhases.SUMMARIZE,
]);
const CONTROL_EVENTS = new Set(["start", "pause", "resume", "stop"]);

export function createModeratorPersona({ initialState = ModeratorStates.INITIALIZING, clock = () => new Date().toISOString() } = {}) {
  const fsm = createModeratorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!moderatorSubscribePhases.includes(phase)) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    if (phase === TickPhases.APPLY && event === "resolve_affinity") {
      const snapshot = view();
      const actions = planModeratorAffinityActions({
        observation: payload?.observation,
        affinityEffects: payload?.affinityEffects,
        tick,
        maxActions: payload?.maxAffinityActions,
      });
      return { ...snapshot, tick, actions, effects: [], telemetry: null };
    }
    if (!event || !CONTROL_EVENTS.has(event)) {
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
    subscribePhases: moderatorSubscribePhases,
    advance,
    view,
  };
}
