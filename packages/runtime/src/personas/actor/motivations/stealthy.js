import {
  buildExitSteps,
  chebyshevDistance,
  resolveBaseTiles,
  resolveObservationView,
  resolveTileKinds,
  sideOf,
  wallsNear,
} from "../proposal-helpers.js";

export default {
  kind: "stealthy",
  /**
   * Heads for the exit like exploring, but of the steps that keep to a shortest route it
   * takes the one furthest from the nearest hostile, then the one closest to the walls
   * (#311).
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   */
  propose({ observation, payload, simConfig }) {
    const { fallback, steps } = buildExitSteps({ observation, payload, simConfig });
    if (steps.length < 2) return fallback;
    const view = resolveObservationView(observation);
    const baseTiles = resolveBaseTiles(payload, view, simConfig);
    const tileKinds = resolveTileKinds(view, payload);
    const { hostiles } = sideOf(view, payload?.actorId);
    const hostileDistance = (cell) => (hostiles.length === 0 ? 0
      : Math.min(...hostiles.map((entry) => chebyshevDistance(cell, entry.actor.position))));
    const score = (cell) => [hostileDistance(cell), wallsNear(cell, tileKinds, baseTiles)];
    const best = steps.reduce((kept, cell) => {
      const [a, b] = [score(cell), score(kept)];
      return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? cell : kept;
    });
    return [{ kind: "move", params: { target: best } }];
  },
};
