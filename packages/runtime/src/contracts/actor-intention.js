/**
 * The actor-intention contract: what an actor MEANS to do this tick.
 *
 * Lives in `contracts/` and not in either persona, for the same reason
 * `constraint-problem.js` does. The Actor produces intentions and owns what a class MEANS;
 * the Moderator consumes them and owns the ORDER they imply. A builder living in either
 * persona would make one import the other's internals, which `persona-boundary` forbids and
 * which caught exactly that mistake on the first attempt at this seam.
 *
 * This module is deliberately opinion-free about ordering. It validates shape and nothing
 * else: giving it a view on which intent should win would move Moderator policy into a
 * contract, which is the defect the constraint-problem contract's header warns about.
 */
import { ACTOR_INTENTION_SCHEMA } from "./artifacts.ts";

export { ACTOR_INTENTION_SCHEMA };
export const ACTOR_INTENTION_SCHEMA_VERSION = 1;

/** Build the intention an Actor surfaces to the Moderator. */
export function buildActorIntention({ actorId, intentClass, intentTag, tick } = {}) {
  return {
    schema: ACTOR_INTENTION_SCHEMA,
    schemaVersion: ACTOR_INTENTION_SCHEMA_VERSION,
    actorId,
    intentClass: Number.isFinite(intentClass) ? intentClass : 0,
    intentTag: typeof intentTag === "string" && intentTag.trim() ? intentTag : "unknown",
    tick: Number.isInteger(tick) ? tick : 0,
  };
}

export function isActorIntention(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.schema === ACTOR_INTENTION_SCHEMA
    && value.schemaVersion === ACTOR_INTENTION_SCHEMA_VERSION
    && typeof value.actorId === "string"
    && value.actorId.length > 0;
}
