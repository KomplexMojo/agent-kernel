import { createOrchestratorStateMachine, OrchestratorStates } from "./state-machine.js";
import { createLlmRound } from "./llm-round.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";

/**
 * Published on the controller surface so callers can run the budget loop without importing
 * persona internals (charter: external code imports persona controllers only) — the same
 * treatment, and the same reason, as `FulfillmentDispositions` on the Moderator's controller.
 *
 * ⚠️ CR.7 / WP-5, 2026-08-12. Four modules imported `orchestrator/llm-budget-loop.js`
 * directly (`ak-impl.mjs`, `adaptive-workflow/llm-seams.js`, `commands/kernel.js`,
 * `ui-web/design-guidance.js`) and were four of the allowlist's live rows. CR.4's D4 predicted
 * one Orchestrator use case returning LLM-request effects would replace them; CR.4 delivered
 * `commands/llm-host.js`, but that hosts a SESSION (`runLlmSessionHosted`) and is a different
 * capability — two of the four already imported it on the line beside this one and still
 * needed the loop. Re-pointing them at `llm-host.js` was therefore never the mechanical fix
 * the board recorded; publishing the capability the callers actually use is.
 *
 * This is safe to publish as a plain function rather than a controller method because it takes
 * no FSM state: every capability it needs (adapter, catalog, priceList, clock, …) is injected
 * by the caller, so nothing about the persona's internal state escapes with it.
 */
export { runLlmBudgetLoop } from "./llm-budget-loop.js";

/**
 * CR.7 / WP-5, 2026-08-12 — the LLM capture artifact builder, published for the TICK plane.
 *
 * `personas/_shared/tick-orchestrator.mts` performs the tick plane's own LLM call and stamps
 * its own capture (`producedBy: "runtime-llm"`), which is a legitimately separate exchange from
 * the build plane's rounds. It reached in for `llm-capture.js` directly and was an allowlist row.
 *
 * Published for the same reason as `runLlmBudgetLoop` above: the artifact's shape is Orchestrator
 * law — it stamps `CAPTURED_INPUT_SCHEMA` — so the answer is to publish the one builder, not to
 * let a second caller grow a second one. It is a pure function with the clock injected, so no FSM
 * state escapes with it.
 */
export { buildLlmCaptureArtifact } from "./llm-capture.js";

/**
 * CR.7 / WP-5 — the PROMPT CONTRACT's two glue-facing functions.
 *
 * `ak-impl.mjs`, `kernel.js` and `ui-flow.js` imported `prompt-contract.js` directly and were
 * three allowlist rows. Both of these are Orchestrator law: `normalizeSummary` validates an LLM
 * summary against the prompt contract, and `deriveAllowedOptionsFromCatalog` merges the base
 * vocabulary with a catalog's entries to produce the option set a prompt may offer.
 *
 * ⚠️ THE FOUR `ALLOWED_*` CONSTANTS ARE DELIBERATELY **NOT** PUBLISHED HERE. They are pure
 * aliases of `contracts/domain-constants.js` values (`AFFINITY_KINDS`, `AFFINITY_EXPRESSIONS`,
 * `MOTIVATION_KINDS`, `DELVER_SETUP_MODES`), and `domain-constants.js` records why that mattered
 * as P5.1 D1: one value wore three names across two personas, and the boundary crossings existed
 * "purely because of the renaming". Publishing the alias would add a fourth name for the same
 * value. Glue imports the contracts names instead, so the hop is gone rather than relocated.
 */
export {
  deriveAllowedOptionsFromCatalog,
  normalizeSummary,
} from "./prompt-contract.js";

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
