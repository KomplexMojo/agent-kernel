/**
 * Moderator-owned ACTOR ordering — who resolves first within a tick.
 *
 * The charter assigns ordering to the Moderator so that "tick semantics are policy, not
 * accidents of the runner loop". `tick-ordering.js` already discharges that for the seven
 * PERSONAS. Actor order was the accident it did not cover: the runner resolved actors in
 * `initialState.actors` array order (`runtime-fsm.mjs:1660`) — the sequence they happened to
 * be written into the build spec — and no persona decided it.
 *
 * ⚠️ THAT ACCIDENT WAS LOAD-BEARING. Measured across 48 two- and three-actor scenarios, 75%
 * had an outcome that depended on resolution order: which actor claims a contested tile, and
 * whether a defender escapes a blow or takes it at 1 health. Only mutual attack was
 * order-independent, and only because nothing gates a downed actor from acting.
 *
 * ORDER BY INTENT CLASS, DESCENDING (maintainer ruling, 2026-09-04). Combat resolves before
 * pursuit, before movement, before waiting. The Actor already computes `intentClass` when it
 * ranks its own candidates and then discarded it; this consumes that existing, Actor-owned
 * meaning rather than deriving a second one. THE MODERATOR MUST NOT REINTERPRET IT — a
 * Moderator that re-derived what "combat" means would be a second authority on Actor policy,
 * which is the F10 defect this codebase has already paid to remove once.
 *
 * TIES BREAK ON ACTOR ID, and that is a real constraint rather than a detail: `ak replay`
 * compares runs frame by frame, so an ordering that varied between runs would break replay
 * outright rather than degrade it. Id is stable, total, and independent of how the build
 * happened to emit the actor list — which is precisely what the array order was not.
 *
 * This module is pure: intentions in, ordered ids out. No clock, no IO, no core access.
 */
import { isActorIntention } from "../../contracts/actor-intention.js";

const isIntention = isActorIntention;

/**
 * Decide the order actors resolve in this tick.
 *
 * `actorIds` is the full set the runner tracks. Every one of them comes back exactly once,
 * whether or not it surfaced an intention — an actor that failed to report must still act, or
 * ordering would silently drop it from the tick. Unreported actors sort as intent class 0,
 * behind everything that did report, which is the same position `profile_mismatch` already
 * occupies in the Actor's own scale.
 */
export function orderActorsByIntention({ actorIds = [], intentions = [] } = {}) {
  const known = Array.isArray(actorIds) ? actorIds.filter((id) => typeof id === "string" && id) : [];
  const byActor = new Map();
  for (const intention of Array.isArray(intentions) ? intentions : []) {
    if (!isIntention(intention)) continue;
    // First intention wins for a given actor: a persona that reported twice in one tick is a
    // defect upstream, and silently taking the last one would hide it.
    if (!byActor.has(intention.actorId)) byActor.set(intention.actorId, intention);
  }
  return known.slice().sort((left, right) => {
    const a = byActor.get(left)?.intentClass ?? 0;
    const b = byActor.get(right)?.intentClass ?? 0;
    if (a !== b) return b - a;
    return String(left).localeCompare(String(right));
  });
}

/** Diagnostic view: what the Moderator decided and why, for telemetry and replay inspection. */
export function describeActorOrdering({ actorIds = [], intentions = [] } = {}) {
  const order = orderActorsByIntention({ actorIds, intentions });
  const byActor = new Map(
    (Array.isArray(intentions) ? intentions : [])
      .filter(isIntention)
      .map((intention) => [intention.actorId, intention]),
  );
  return order.map((actorId, position) => ({
    actorId,
    position,
    intentClass: byActor.get(actorId)?.intentClass ?? 0,
    intentTag: byActor.get(actorId)?.intentTag ?? "unreported",
  }));
}
