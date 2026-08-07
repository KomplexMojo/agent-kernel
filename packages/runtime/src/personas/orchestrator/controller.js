import { createOrchestratorStateMachine, OrchestratorStates } from "./state-machine.js";
import { createLlmRound } from "./llm-round.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";

export const orchestratorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE, TickPhases.EMIT]);

export function createOrchestratorPersona({ initialState = OrchestratorStates.IDLE, clock, from } = {}) {
  const fsm = createOrchestratorStateMachine({ initialState, clock, from });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!orchestratorSubscribePhases.includes(phase) || !event) {
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

  /**
   * The LLM conversation, published on the persona surface (CR.4 M3).
   *
   * This is the entry point that replaces `import { runLlmSession }`. Callers get a
   * round that RETURNS `llm_request` effects and never performs IO; the host dispatches
   * them through `ports/effects.js` and feeds responses back with `fulfill()`.
   *
   * Published here on purpose: `llm-round.js` is persona-internal, and a caller
   * importing it directly would be exactly the boundary crossing CR.4 is closing — it
   * would simply replace 12 allowlisted imports of `llm-session.js` with 12 of
   * `llm-round.js`. Reaching the round through the controller is the point.
   */
  const llm = Object.freeze({
    /**
     * PX.3: the round stamps `phaseTiming` into a persisted capture artifact, so it needs
     * a clock — and the persona already has one injected. It supplies its own rather than
     * making every caller re-pass it, and `clock: undefined` from a caller must not
     * clobber it (the CR.9 M5 `withPersonaDefaults` lesson, same defect, different file).
     */
    beginRound: (args = {}) => createLlmRound({
      clock,
      ...(args.clock === undefined ? { ...args, clock } : args),
      personaRef: "orchestrator",
    }),
  });

  return {
    subscribePhases: orchestratorSubscribePhases,
    advance,
    view,
    llm,
  };
}
