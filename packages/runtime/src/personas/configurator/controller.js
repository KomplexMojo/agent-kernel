import { createConfiguratorStateMachine, ConfiguratorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildSolverRequestEffect } from "../_shared/persona-helpers.mts";
import { attachConfiguratorServices } from "./configurator-services.js";

export const configuratorSubscribePhases = Object.freeze([TickPhases.INIT, TickPhases.OBSERVE]);

export function createConfiguratorPersona({ initialState = ConfiguratorStates.UNINITIALIZED, clock } = {}) {
  const fsm = createConfiguratorStateMachine({ initialState, clock });
  const services = attachConfiguratorServices({ fsm });

  function view() {
    const snapshot = fsm.view();
    return { ...snapshot, context: { ...snapshot.context, ...services.serviceContext() } };
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!configuratorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    const effects = [];
    const solverEffect = buildSolverRequestEffect({
      solverRequest: payload.solver || payload.solverRequest,
      intentRef: payload.intentRef,
      planRef: payload.planRef,
      personaRef: "configurator",
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
    subscribePhases: configuratorSubscribePhases,
    advance,
    view,
    provideConfig: services.provideConfig,
    prepareLevelGen: services.prepareLevelGen,
    mapResources: services.mapResources,
    validate: services.validate,
    lock: services.lock,
    lockedConfig: services.lockedConfig,
  };
}
