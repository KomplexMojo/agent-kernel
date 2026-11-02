/**
 * `ai_controlled` (Darren, 2026-11-02): any actor, hazards included, may be driven by an AI.
 *
 * Like `user_controlled` it proposes nothing of its own: the actor's turn is the AI's, given
 * through the same seat and legal-action list a player uses (`ak_play_*`), and an actor it
 * does not command plays its other motivations. It is a different KIND so a level says who is
 * at the controls (a player or an AI) and the Allocator prices the seat.
 */
export default {
  kind: "ai_controlled",
  /** @returns {Array<{kind: string, params: object}>} candidates, never a decision. */
  propose() {
    return [];
  },
};
