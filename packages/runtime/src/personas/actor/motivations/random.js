import { buildRandomMoveProposals } from "../proposal-helpers.js";

export default {
  kind: "random",
  /**
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   */
  propose({ observation, payload, simConfig, personaSeed, params }) {
    return buildRandomMoveProposals({ observation, payload, simConfig, personaSeed });
  },
};
