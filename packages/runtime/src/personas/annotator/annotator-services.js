/**
 * Annotator service surface — the synchronous API behind the controller.
 *
 * Mirrors allocator-services.js / director-services.js / configurator-services.js:
 * the persona's domain logic lives in sibling internals (run-summary.js), and
 * nothing outside personas/annotator/ imports them directly — callers go
 * through the controller.
 *
 * State gating (CORRECTED by CR.8, 2026-08-01): summarizeRun is still a pure
 * derivation and still callable in any FSM state — but the reasoning that used to
 * sit here, "the run loop's Annotator instance is not the instance the kernel holds
 * when the run ends, so that state could never be meaningful", described a defect
 * rather than a design. kernel.js was minting a fresh idle persona purely to stamp
 * producedBy:"annotator" while the instance that recorded every tick frame was
 * discarded (A5, honest provenance).
 *
 * The kernel now goes through `runtime.summarizeRun()`, which delegates to the
 * Annotator the runtime actually ran and REFUSES to summarize a run that ticked if
 * that instance is still `idle`. The provenance gate lives there, at the seam that
 * knows whether a run happened; this surface stays a pure derivation on purpose.
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
