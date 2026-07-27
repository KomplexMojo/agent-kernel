/**
 * Annotator service surface — the synchronous API behind the controller.
 *
 * Mirrors allocator-services.js / director-services.js / configurator-services.js:
 * the persona's domain logic lives in sibling internals (run-summary.js), and
 * nothing outside personas/annotator/ imports them directly — callers go
 * through the controller.
 *
 * State gating: summarizeRun is a PURE DERIVATION over frames the caller has
 * already collected — it issues no effects and mutates no persona state, so
 * like the Allocator's read-only pricing.* surface it is available in any FSM
 * state. Gating it behind the per-tick idle→recording→summarizing round would
 * be empty ceremony: the run loop's Annotator instance is not the instance the
 * kernel holds when the run ends, so that state could never be meaningful here.
 *
 * Shared by controller.js and controller.mts so the two entry points cannot drift.
 */
import { buildRunSummary, deriveRunOutcome } from "./run-summary.js";

export function attachAnnotatorServices() {
  /**
   * Produces the end-of-run RunSummary artifact from collected tick frames and
   * the effect log. Returns the artifact; persistence stays with the caller.
   */
  function summarizeRun(args = {}) {
    return buildRunSummary(args);
  }

  /** Outcome classification alone, for callers that only need the verdict. */
  function classifyRunOutcome(args = {}) {
    return deriveRunOutcome(args);
  }

  return {
    summarizeRun,
    classifyRunOutcome,
  };
}
