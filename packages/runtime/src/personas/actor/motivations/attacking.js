export default {
  kind: "attacking",
  /**
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   * Combat/hold kinds stay empty in MC.1 — routing still owns those branches.
   */
  propose({ observation, payload, simConfig, personaSeed, params }) {
    return [];
  },
};
