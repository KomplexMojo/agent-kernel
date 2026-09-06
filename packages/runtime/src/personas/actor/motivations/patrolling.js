import { buildPatrolProposals, buildRandomMoveProposals } from "../proposal-helpers.js";

export default {
  kind: "patrolling",
  /**
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   * Patterns (Configurator vocabulary): loop | ping_pong | random_walk.
   */
  propose({ observation, payload, simConfig, personaSeed, params }) {
    const pattern = typeof params?.pattern === "string"
      ? params.pattern.trim().toLowerCase()
      : "loop";
    if (pattern === "random_walk") {
      return buildRandomMoveProposals({ observation, payload, simConfig, personaSeed });
    }
    return buildPatrolProposals({ observation, payload, simConfig, params: { pattern } });
  },
};
