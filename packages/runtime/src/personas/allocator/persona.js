import { createAllocatorStateMachine, AllocatorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.js";
import { buildAction, buildRequestActionsFromEffects, buildSolverRequestEffect } from "../_shared/persona-helpers.js";

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
    const actions = [];
    const budgetLimit = typeof payload?.budget?.effects === "number" ? payload.budget.effects : Number.MAX_SAFE_INTEGER;

    const fromEffects = buildRequestActionsFromEffects(payload.effects, {
      tick,
      personaRef: "allocator",
      actorId: "allocator",
      budgetRemaining: budgetLimit,
    });
    actions.push(...fromEffects.actions);
    let remaining = fromEffects.remaining;

    if (Array.isArray(payload.externalFactPrompts)) {
      for (const prompt of payload.externalFactPrompts) {
        if (remaining <= 0) {
          break;
        }
        const requestId = prompt.requestId || prompt.id || `fact_${actions.length}`;
        actions.push(
          buildAction({
            tick,
            kind: "request_external_fact",
            actorId: "allocator",
            personaRef: "allocator",
            params: { requestId, query: prompt.query, targetAdapter: prompt.targetAdapter || "fixtures" },
          }),
        );
        remaining -= 1;
      }
    }

    if (Array.isArray(payload.solverPrompts)) {
      for (const prompt of payload.solverPrompts) {
        if (remaining <= 0) {
          break;
        }
        const requestId = prompt.requestId || prompt.id || `solver_${actions.length}`;
        actions.push(
          buildAction({
            tick,
            kind: "request_solver",
            actorId: "allocator",
            personaRef: "allocator",
            params: { requestId, problem: prompt.problem, targetAdapter: prompt.targetAdapter || "solver" },
          }),
        );
        remaining -= 1;
      }
    }

    const solverEffect = buildSolverRequestEffect({
      solverRequest: payload.solver || payload.solverRequest,
      personaRef: "allocator",
      targetAdapter: payload.targetAdapter,
    });
    if (solverEffect) {
      effects.push(solverEffect);
      result.context = { ...result.context, lastSolverRequest: solverEffect.request };
    }
    result.context = { ...result.context, budgetRemaining: remaining };

    return {
      ...result,
      tick,
      actions,
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
