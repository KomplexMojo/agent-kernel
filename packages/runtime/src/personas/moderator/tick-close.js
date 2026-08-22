/**
 * AM.3b + AM.7 — what happens when a tick CLOSES, decided by the Moderator.
 *
 * The charter gives the Moderator tick control and affinity resolution. Two
 * things happen at the end of every tick and neither was owned by it:
 *
 *   - **Advancing the tick.** AM.3 moved this out of `rules/move.ts commitMove`,
 *     where it had been a side effect of a successful move, and into the runner.
 *     That fixed the semantics but left glue doing it unconditionally: the
 *     Moderator's `pausing` gate was honoured, yet the Moderator never *said*
 *     "advance", so it had no seam to hold or to advance differently.
 *   - **Recomputing the affinity field.** `computeAffinityField()` ran exactly
 *     once, during setup (F7). Actors moved; their auras stayed where the actors
 *     had started. A field that never follows its source is decoration.
 *
 * This is a PLANNING function in the same sense as `planPersonaOrder` and
 * `planEffectFulfillment`: it answers a question as data and transitions no
 * state. The runner executes what it returns. Glue keeps sequence; the persona
 * keeps the decision.
 */

/** A tick that is paused closes nothing: no advance, no recompute. */
export const TICK_CLOSE_REASONS = Object.freeze({
  ADVANCED: "advanced",
  PAUSED: "paused",
});

/**
 * @param {object} args
 * @param {string} [args.state] the Moderator's current FSM state
 * @returns {{advanceTick: boolean, recomputeAffinityField: boolean, reason: string}}
 */
export function planTickClose({ state } = {}) {
  const paused = state === "pausing" || state === "paused";
  if (paused) {
    return {
      advanceTick: false,
      recomputeAffinityField: false,
      reason: TICK_CLOSE_REASONS.PAUSED,
    };
  }
  return {
    advanceTick: true,
    // The field is recomputed WITH the advance, not independently: both describe
    // the same instant. Recomputing while refusing to advance would publish a
    // field for a tick that never happened.
    recomputeAffinityField: true,
    reason: TICK_CLOSE_REASONS.ADVANCED,
  };
}
