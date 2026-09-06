import { buildMoveProposal } from "../proposal-helpers.js";

export default {
  kind: "stealthy",
  /**
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   */
  propose({ observation, payload, simConfig, personaSeed, params }) {
    return buildMoveProposal({ observation, payload, simConfig });
  },
};
