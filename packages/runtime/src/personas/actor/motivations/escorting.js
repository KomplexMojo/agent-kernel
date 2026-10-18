export default {
  kind: "escorting",
  /**
   * #251 — keeps near one ally and follows it. The following is the controller's escort
   * turn (the `follow` goal on the authored ally, or the playable delver), which runs
   * before motivations are asked: further than its distance, the escort steps toward the
   * ally and motivations are not consulted. Within reach, or with nothing to follow, the
   * turn comes here, and escorting's own candidate is to hold where it is; any other
   * motivation's candidates join it (kept within reach of the ally while there is one).
   * @returns {Array<{kind: string, params: object}>} candidates, never a decision.
   */
  propose() {
    return [{ kind: "wait" }];
  },
};
