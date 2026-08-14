/**
 * CR.4 M5b.2a′ — open a Director build round for glue that needs one.
 *
 * `runLlmBudgetLoop` no longer maps LLM summaries onto catalog pools itself; it asks the
 * Director, through `director.mapPool`, which is FSM-gated behind an open build round
 * (`requireState(PLANNED_STATES)`). That gate is the point: until now the loop mapped
 * summaries with **no Director round existing at all** — an artifact produced with no
 * round, the same defect as CR.4's `producedBy` stamp and CR.3's discarded plan.
 *
 * `kernel.js` already did this correctly (its llm-plan path builds a Director, synthesizes
 * an IntentEnvelope and calls `beginBuild` before the first `mapPool`). The other four
 * composition roots that drive the loop had **no Director at all**, so this is kernel's
 * wiring extracted rather than reinvented — four hand-rolled copies of an IntentEnvelope
 * is how a vocabulary ends up with four silently diverging origins.
 */

import { createDirectorPersona } from "../personas/director/persona.js";
import { INTENT_ENVELOPE_SCHEMA } from "../contracts/artifacts.ts";


/**
 * Build a Director and open its round, returning the persona ready for `mapPool`.
 *
 * The round's instant is injected, never read from the wall clock (PX.3). It comes from
 * `createdAt` when the caller has one, and otherwise from the `clock` the caller supplies;
 * only a caller with NEITHER is refused (maintainer decision 1, 2026-08-12).
 *
 * ⚠️ **THE DERIVATION IS NOT A CONVENIENCE — IT IS WHAT LET THE LAST BOUNDARY ROWS CLOSE.**
 * This function required `createdAt` outright while `buildspec-assembler.js`, the module it
 * fronts, has always stamped `createdAt || requireClock(clock, "director")()`. So the round
 * opener refused inputs the assembler accepts, and routing `ui-flow.js` and `ak-impl.mjs`
 * through the persona would have THROWN where they work today —
 * `ui-web/card-builder-controller.js` passes a live clock with `createdAt: undefined`, and
 * `cli-worker/shared.js` forwards an opaque payload. The two allowlist rows were blocked on
 * this disagreement, not on effort.
 *
 * ⚠️ **THE CLOCK IS READ ONCE AND THE ROUND IS FROZEN TO THAT INSTANT.** Handing the live
 * clock to the persona would let two artifacts from one round carry different timestamps —
 * a determinism loss that stays well-formed and therefore invisible to every output gate,
 * which is the whole shape of PX.3. One round, one instant.
 */
export function beginDirectorRound({ runId, createdAt, clock, goal, producedBy = "cli" } = {}) {
  const supplied = typeof createdAt === "string" && createdAt.trim() ? createdAt : null;
  // A clock that answers with something that cannot BE a createdAt is refused here rather
  // than stamped: `undefined` or a raw epoch number reaching meta.createdAt is exactly the
  // quiet degradation this refusal exists to stop.
  const derived = supplied === null && typeof clock === "function" ? clock() : null;
  const roundCreatedAt = supplied
    ?? (typeof derived === "string" && derived.trim() ? derived : null);

  if (roundCreatedAt === null) {
    throw new Error(
      "beginDirectorRound: supply createdAt (ISO-8601), or a clock that returns one — the "
      + "round stamps an instant into a persisted artifact and a persona never reads the "
      + "wall clock (PX.3). "
      + (typeof clock === "function"
        ? `The clock returned ${JSON.stringify(derived)}.`
        : "Neither was supplied."),
    );
  }
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("beginDirectorRound: runId is required for deterministic provenance.");
  }

  const director = createDirectorPersona({ clock: () => roundCreatedAt });
  director.beginBuild({
    schema: INTENT_ENVELOPE_SCHEMA,
    schemaVersion: 1,
    meta: { id: `intent_${runId}`, runId, createdAt: roundCreatedAt, producedBy },
    source: producedBy,
    intent: { goal: typeof goal === "string" && goal.trim() ? goal : `build ${runId}` },
  }, { runId });

  return director;
}

/**
 * CR.4 M5b.2b — every build-domain capability `runLlmBudgetLoop` requires, from ONE round.
 *
 * The loop asks the Director for the pool mapping it already asked for, plus every pricing
 * answer it used to compute inline out of the Allocator's internals. Under Option 1 the
 * Director is its sole counterpart, so they all come from the SAME open build round —
 * separate rounds would be several build rounds for a single build, which is the
 * "artifact produced with no round" defect wearing a different hat.
 *
 * Bundled here for the same reason `beginDirectorRound` itself is: five composition roots
 * spreading the same properties by hand is five copies free to diverge silently.
 *
 * ⚠️ The count is deliberately not written down. It has been "four" since M5b.2b while the
 * set grew twice (M5b.2c `fitLayout`, M5b.2d `evaluateLayoutSpend`) — a number in prose is
 * a second origin for something the object literal below already states exactly.
 */
export function beginDirectorBuildCapabilities(options = {}) {
  return directorBuildCapabilities(beginDirectorRound(options));
}

/**
 * The same capability set, taken from a round the caller ALREADY has open.
 *
 * Split out 2026-08-12 (P5.1 item D): `ak-impl.mjs`'s llm-plan path now opens one round for
 * the whole build — the loop's capabilities, the cardSet builder, and the BuildSpec
 * assembly that closes it — where each branch used to open its own. A caller in that
 * position must not call `beginDirectorBuildCapabilities`: that opens a SECOND round for one
 * build, which is the "artifact produced with no round" defect wearing its other hat.
 *
 * The set is stated once, here, for the reason the note above gives: composition roots
 * spreading these properties by hand are copies free to diverge silently.
 */
export function directorBuildCapabilities(director) {
  return {
    mapPool: director.mapPool,
    buildCardSet: director.buildCardSet,
    resolveTileCosts: director.resolveTileCosts,
    allocateBudget: director.allocateBudget,
    evaluateSelectionSpend: director.evaluateSelectionSpend,
    fitLayout: director.fitLayoutToBudget,
    evaluateLayoutSpend: director.evaluateLayoutSpend,
    assessFeasibility: director.assessFeasibility,
  };
}
