import { buildMoveProposal, holdsForHeldRoute } from "../proposal-helpers.js";

export default {
  kind: "exploring",
  /**
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   * A way held by another actor is waited out or detoured on a seeded coin rather than
   * stepped back from every tick (#645).
   */
  propose({ observation, payload, simConfig, personaSeed, params }) {
    const proposals = buildMoveProposal({ observation, payload, simConfig });
    if (proposals.length === 1 && holdsForHeldRoute({ observation, payload, simConfig, step: proposals[0], personaSeed })) {
      return [{ kind: "wait" }];
    }
    return proposals;
  },
};
