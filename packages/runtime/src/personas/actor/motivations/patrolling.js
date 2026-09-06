import { buildPatrolProposals } from "../proposal-helpers.js";

export default {
  kind: "patrolling",
  /**
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   */
  propose({ observation, payload, simConfig, personaSeed, params }) {
    return buildPatrolProposals({ observation, payload, simConfig });
  },
};
