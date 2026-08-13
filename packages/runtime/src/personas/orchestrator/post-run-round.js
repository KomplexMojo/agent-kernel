/**
 * P5.5 — post-run coordination of deferred side effects, as a round that performs NO IO.
 *
 * The charter, this persona's README and the Moderator's have all described this since the
 * persona model was enforced: effects that cannot be satisfied deterministically during
 * execution are recorded, and the Orchestrator fulfils them AFTER the run, capturing the
 * results as artifacts so a future run can be deterministic. None of it existed.
 * `dispatchEffect` marked effects `deferred`, the Moderator's fulfilment plan recorded the
 * disposition, and the only thing downstream was `ak inspect`, which COUNTED them. The
 * records then went nowhere, which is indistinguishable in every output test from a run
 * that had nothing to coordinate.
 *
 * The shape follows `llm-round.js` exactly, and for the same reason: the round hands back
 * effects and STOPS. The host dispatches them, the adapter does the IO, and results arrive
 * through `fulfill()`. Nothing here awaits anything, reads a clock directly, or touches an
 * adapter.
 *
 *     idle ──begin──▶ coordinating ──settle──▶ settled
 *
 * ⚠️ **The charter's hard line runs through this file.** Post-run effects are initiated
 * only after execution has completed and the simulation's facts are final, and externally
 * obtained data is NEVER fed back into a running simulation. That is why this is a separate
 * round rather than another tick phase: a coordination that could run mid-tick would be one
 * refactor away from becoming an input to the run that produced it.
 *
 * States gate real behavior (charter: label-only states are a defect). `fulfill()` before
 * `begin()` throws, `begin()` twice throws, a settled round refuses both, and `fulfill()`
 * refuses a requestId the round never issued — a coordination that accepted an answer to a
 * question it did not ask would capture a fact with no provenance, which is the opposite of
 * what the capture is for.
 */

import { CAPTURED_INPUT_SCHEMA } from "../../contracts/artifacts.ts";

export const PostRunRoundStates = Object.freeze({
  IDLE: "idle",
  COORDINATING: "coordinating",
  SETTLED: "settled",
});

/**
 * Pull the effects a run deferred out of its tick frames.
 *
 * Exported because the runner needs the same definition of "deferred" the round does, and
 * two definitions of that would be the CR.1 defect class: the runner would coordinate a
 * different set than the round reports on, and both would look right.
 *
 * @param {Array<object>} tickFrames
 * @returns {Array<{effect: object, reason?: string, tick?: number}>}
 */
export function collectDeferredEffects(tickFrames = []) {
  const deferred = [];
  for (const frame of Array.isArray(tickFrames) ? tickFrames : []) {
    for (const record of Array.isArray(frame?.fulfilledEffects) ? frame.fulfilledEffects : []) {
      if (record?.status !== "deferred" || !record.effect) continue;
      deferred.push({ effect: record.effect, reason: record.reason, tick: frame.tick });
    }
  }
  return deferred;
}

/**
 * The round's own correlation id, distinct from the effect's `requestId`.
 *
 * ⚠️ **These are not interchangeable, and treating them as one silently loses work.** An
 * effect's `requestId` is core's request sequence, and the SAME request can be deferred on
 * several ticks — so a round keyed on `requestId` merges those into one slot, coordinates it
 * once, and reports a `deferredCount` smaller than what the run actually deferred. That is
 * the same class of quiet loss this whole item exists to end, reintroduced inside its own
 * fix. The correlation id is unique per deferred RECORD; the `requestId` still travels on
 * the effect, because the adapter needs it and the capture records it.
 */
function coordinationIdFor(index) {
  return `coordination_${index}`;
}

export function createPostRunCoordinationRound({
  deferred = [],
  runId,
  clock,
  meta,
  producedBy = "orchestrator",
} = {}) {
  let state = PostRunRoundStates.IDLE;
  /** requestId → { entry, outcome | null } */
  const pending = new Map();
  let startedAt;

  function view() {
    let fulfilled = 0;
    for (const slot of pending.values()) if (slot.outcome) fulfilled += 1;
    return {
      state,
      context: {
        deferredCount: pending.size || deferred.length,
        fulfilledCount: fulfilled,
      },
    };
  }

  function begin() {
    if (state !== PostRunRoundStates.IDLE) {
      throw new Error(
        `post-run-round: begin() is only valid from idle; the round is ${state}.`,
      );
    }
    if (!Array.isArray(deferred) || deferred.length === 0) {
      // A coordination round over nothing would settle with an empty capture set that
      // reads exactly like a run whose deferrals were all satisfied. Refusing keeps
      // "nothing was deferred" and "everything was coordinated" distinguishable.
      throw new Error(
        "post-run-round: there is nothing to coordinate. A run with no deferred effects "
        + "must not open a coordination round — an empty settlement is indistinguishable "
        + "from a complete one.",
      );
    }

    startedAt = typeof clock === "function" ? clock() : undefined;
    const effects = deferred.map((entry, index) => {
      const coordinationId = coordinationIdFor(index);
      pending.set(coordinationId, { entry, outcome: null });
      // The effect is re-issued AS DATA, unchanged apart from the correlation id and the
      // marking that says this is the post-run attempt. The host dispatches it; this round
      // never does.
      return { ...entry.effect, coordinationId, fulfillment: "post_run" };
    });

    state = PostRunRoundStates.COORDINATING;
    return { state, effects, view: view() };
  }

  /**
   * Record what an adapter returned for one deferred effect.
   *
   * @param {{coordinationId: string, status?: string, payload?: unknown,
   *   contentType?: string, adapter?: string, reason?: string}} response keyed by the
   *   round's correlation id, not the effect's requestId — see `coordinationIdFor`.
   */
  function fulfill(response = {}) {
    if (state !== PostRunRoundStates.COORDINATING) {
      throw new Error(
        `post-run-round: fulfill() is only valid while coordinating; the round is ${state}.`,
      );
    }
    const slot = pending.get(response.coordinationId);
    if (!slot) {
      throw new Error(
        `post-run-round: no deferred effect was issued for coordinationId "${response.coordinationId}". `
        + "A capture built from an unrequested answer would carry provenance it did not earn.",
      );
    }
    if (slot.outcome) {
      throw new Error(
        `post-run-round: coordinationId "${response.coordinationId}" already has an outcome. `
        + "One deferred effect gets one answer, so a capture cannot be silently overwritten.",
      );
    }
    slot.outcome = {
      status: response.status || "fulfilled",
      payload: response.payload,
      contentType: response.contentType || "application/json",
      adapter: response.adapter || slot.entry.effect?.targetAdapter || "unknown",
      reason: response.reason,
    };
    return { state, view: view() };
  }

  /**
   * Close the round: captures for what was answered, an explicit outstanding list for what
   * was not.
   *
   * ⚠️ **Outstanding effects are REPORTED, never dropped.** The failure this whole item
   * exists to end is deferred work disappearing quietly; a settlement that listed only its
   * successes would reintroduce it one layer up.
   */
  function settle() {
    if (state !== PostRunRoundStates.COORDINATING) {
      throw new Error(
        `post-run-round: settle() is only valid while coordinating; the round is ${state}.`,
      );
    }
    const endedAt = typeof clock === "function" ? clock() : undefined;
    const captures = [];
    const outstanding = [];

    let index = 0;
    for (const [coordinationId, slot] of pending) {
      if (slot.outcome?.status === "fulfilled") {
        captures.push({
          schema: CAPTURED_INPUT_SCHEMA,
          schemaVersion: 1,
          meta: {
            ...(meta || {}),
            id: `${runId || "run"}_deferred_${index}`,
            producedBy,
            ...(runId ? { runId } : {}),
            ...(endedAt ? { createdAt: endedAt } : {}),
          },
          source: {
            adapter: slot.outcome.adapter,
            requestId: slot.entry.effect?.requestId,
            request: slot.entry.effect?.data,
          },
          contentType: slot.outcome.contentType,
          payload: slot.outcome.payload,
        });
      } else {
        outstanding.push({
          coordinationId,
          requestId: slot.entry.effect?.requestId,
          kind: slot.entry.effect?.kind,
          targetAdapter: slot.entry.effect?.targetAdapter,
          tick: slot.entry.tick,
          // Why it is still outstanding: the run-time defer reason when nobody answered
          // at all, or the post-run reason when an adapter answered and declined.
          reason: slot.outcome?.reason || slot.entry.reason || "not_coordinated",
        });
      }
      index += 1;
    }

    state = PostRunRoundStates.SETTLED;
    return {
      state,
      result: {
        runId: runId ?? null,
        deferredCount: pending.size,
        captures,
        outstanding,
        timing: { startedAt, endedAt },
      },
      view: view(),
    };
  }

  return { view, begin, fulfill, settle, states: PostRunRoundStates };
}
