import {
  buildExitSteps,
  buildMoveProposal,
  chebyshevDistance,
  findPath,
  resolveActor,
  resolveBaseTiles,
  resolveObservationView,
  resolveTileKinds,
  sideOf,
} from "../proposal-helpers.js";

/** How far a friendly actor lets its nearest ally get before it goes back to it. */
export const FRIENDLY_REACH = 2;

export default {
  kind: "friendly",
  /**
   * Keeps with its side (#311). With no ally in sight it heads for the exit like
   * exploring. An ally further than FRIENDLY_REACH is gone back to first; otherwise it
   * takes the step toward the exit that stays within reach of that ally, nearest first,
   * and waits when every such step would leave it behind. `friendly` is also what makes
   * an actor a companion the player may order (play session).
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   */
  propose({ observation, payload, simConfig }) {
    const view = resolveObservationView(observation);
    const [ally] = sideOf(view, payload?.actorId).allies;
    if (!ally) return buildMoveProposal({ observation, payload, simConfig });
    const actor = resolveActor(view, payload?.actorId, observation);
    const baseTiles = resolveBaseTiles(payload, view, simConfig);
    const tileKinds = resolveTileKinds(view, payload);
    if (ally.distance > FRIENDLY_REACH) {
      const path = findPath(actor.position, ally.actor.position, tileKinds, baseTiles);
      return path && path.length > 2 ? [{ kind: "move", params: { target: path[1] } }] : [{ kind: "wait" }];
    }
    const { fallback, steps } = buildExitSteps({ observation, payload, simConfig });
    if (steps.length === 0) return fallback;
    const within = steps
      .map((cell) => ({ cell, distance: chebyshevDistance(cell, ally.actor.position) }))
      .filter((entry) => entry.distance <= FRIENDLY_REACH);
    if (within.length === 0) return [{ kind: "wait" }];
    const best = within.reduce((kept, entry) => (entry.distance < kept.distance ? entry : kept));
    return [{ kind: "move", params: { target: best.cell } }];
  },
};
