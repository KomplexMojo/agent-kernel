// Moderator-owned effect fulfilment policy (CR.5).
//
// The charter assigns "effect fulfillment" to the Moderator. Until CR.5 the
// decision lived inside the runner's flushEffects(), which both DECIDED the
// disposition and CALLED the adapter, so the persona that owns tick semantics was
// never consulted and there was no seam at which to observe the decision.
//
// This module decides; it never dispatches. It is pure: effect records in, a plan
// out — no adapters, no IO, no clock. The runner executes the plan, and actual
// dispatch stays behind ports/effects.js (the adapter boundary).
//
// The plan also carries the EMISSION ORDER, because ordering effects is the same
// chartered responsibility as ordering personas.

export const FulfillmentDispositions = Object.freeze({
  /** Satisfied from data already on the effect; no adapter involved. */
  DETERMINISTIC: "deterministic",
  /** Not satisfiable this tick; recorded with a reason, no adapter involved. */
  DEFER: "defer",
  /** Handed to the effects port for adapter routing. */
  DISPATCH: "dispatch",
});

/**
 * Decide one effect's disposition.
 *
 * Branch order is significant and is preserved from the pre-CR.5 runner: a
 * `need_external_fact` is judged on its sourceRef BEFORE any pre-existing
 * `fulfillment: "deferred"` marking is considered. A fact effect carrying both a
 * missing sourceRef and a deferred marking therefore reports `missing_source_ref`,
 * which is the more specific reason.
 */
function decide(effect) {
  if (effect?.kind === "need_external_fact") {
    if (effect.sourceRef) {
      return {
        disposition: FulfillmentDispositions.DETERMINISTIC,
        fulfillment: "deterministic",
        status: "fulfilled",
        result: {
          sourceRef: effect.sourceRef,
          requestId: effect.requestId,
          targetAdapter: effect.targetAdapter,
        },
      };
    }
    return {
      disposition: FulfillmentDispositions.DEFER,
      fulfillment: "deferred",
      status: "deferred",
      reason: "missing_source_ref",
    };
  }

  if (effect?.fulfillment === "deferred") {
    return {
      disposition: FulfillmentDispositions.DEFER,
      status: "deferred",
      reason: "deferred_effect",
    };
  }

  return { disposition: FulfillmentDispositions.DISPATCH };
}

/**
 * Plan fulfilment for one flush.
 *
 * @param {{ effects?: Array<object> }} params effect records, in the order core
 *   emitted them. Index positions are core's, and are the sort tiebreak.
 * @returns {Array<{ index: number, disposition: string, fulfillment?: string,
 *   status?: string, reason?: string, result?: object }>} one entry per effect, in
 *   EMISSION order (sorted by effect id, ties broken by core index).
 */
export function planEffectFulfillment({ effects = [] } = {}) {
  const list = Array.isArray(effects) ? effects : [];
  const planned = list.map((effect, index) => ({ index, id: effect?.id || "", ...decide(effect) }));

  planned.sort((a, b) => {
    if (a.id === b.id) {
      return a.index - b.index;
    }
    return a.id < b.id ? -1 : 1;
  });

  return planned.map(({ id, ...entry }) => entry);
}
