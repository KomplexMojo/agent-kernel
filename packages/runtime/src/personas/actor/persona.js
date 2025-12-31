import { createActorStateMachine, ActorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";
import { buildAction, buildRequestActionsFromEffects } from "../_shared/persona-helpers.js";

export const actorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE]);

export function createActorPersona({ initialState = ActorStates.IDLE, clock = () => new Date().toISOString() } = {}) {
  const fsm = createActorStateMachine({ initialState, clock });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!actorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    const baseActorId = payload.actorId || "actor";
    const actions = [];
    const proposals = Array.isArray(payload.proposals) ? payload.proposals : [];
    for (let i = 0; i < proposals.length; i += 1) {
      const proposal = proposals[i];
      actions.push(
        buildAction({
          tick,
          kind: proposal.kind || "custom",
          actorId: baseActorId,
          personaRef: "actor",
          params: proposal.params || proposal,
        }),
      );
    }

    const log = payload.trace;
    if (log) {
      actions.push(
        buildAction({
          tick,
          kind: "emit_log",
          actorId: baseActorId,
          personaRef: "actor",
          params: { severity: log.severity || "info", message: log.message || "actor_log" },
        }),
      );
    }

    if (payload.telemetry) {
      actions.push(
        buildAction({
          tick,
          kind: "emit_telemetry",
          actorId: baseActorId,
          personaRef: "actor",
          params: { data: payload.telemetry },
        }),
      );
    }

    const fromEffects = buildRequestActionsFromEffects(payload.effects, {
      tick,
      personaRef: "actor",
      actorId: baseActorId,
      budgetRemaining: typeof payload?.budget?.effects === "number" ? payload.budget.effects : Number.MAX_SAFE_INTEGER,
    });
    actions.push(...fromEffects.actions);

    return {
      ...result,
      tick,
      actions,
      effects: [],
      telemetry: null,
    };
  }

  return {
    subscribePhases: actorSubscribePhases,
    advance,
    view,
  };
}
