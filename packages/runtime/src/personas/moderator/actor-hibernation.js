/**
 * Moderator-owned actor hibernation — who may DECIDE this tick on vast boards.
 *
 * Intent (maintainer / playtest AK-21 follow-up): the level stays alive — wardens act even
 * off-camera, because this is their home and a threat arrived. Activity is NOT tied to fog or
 * the camera. Actors within a Chebyshev radius of the current controlled actor take turns;
 * beyond that they hibernate (skip Actor decide/propose) until the focus moves near again.
 *
 * Metric: Chebyshev (max(|dx|,|dy|)) — same as sight radius and cast reach ("N tiles in each
 * direction" is a square). Field projection still uses Manhattan for affinity falloff; that is
 * a different physical model and is not reused here.
 *
 * Lifecycle while hibernating:
 * - Skipped from the DECIDE loop: no AI proposal, no reserved-target claims.
 * - Still in the registry: lasting fields still project from/onto them; regen/upkeep/exits still
 *   run in the apply/close path. Hibernation is decide/propose cost only, not a second lifecycle.
 * - An actor with an explicit command this tick is always awake (player input cannot be dropped).
 * - #700: an actor that can never take a turn of its own (cannot move, no motivations) never
 *   enters decide, near the focus or not: on a vast level most actors are walls and props, and
 *   asking each one every tick only ever produced nothing. A command or a strategy wakes it.
 *
 * Pure: positions + ids in, awake ids out. No clock, no IO, no core access.
 */

/** Default wake radius in tiles (Chebyshev). Configurable per run/step. */
export const DEFAULT_ACTOR_HIBERNATION_RADIUS = 50;

/**
 * Resolve the hibernation radius.
 * - `undefined` → default 50
 * - `false` / `null` / `Infinity` → disabled (everyone awake)
 * - finite number ≥ 0 → that radius
 * - anything else → default 50
 */
export function resolveActorHibernationRadius(raw) {
  if (raw === false || raw === null || raw === Infinity) return Infinity;
  if (raw === undefined) return DEFAULT_ACTOR_HIBERNATION_RADIUS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ACTOR_HIBERNATION_RADIUS;
  return n;
}

/** Chebyshev distance between two grid positions. */
export function chebyshevTileDistance(a, b) {
  if (!a || !b) return Infinity;
  if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !Number.isInteger(b.x) || !Number.isInteger(b.y)) {
    return Infinity;
  }
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * #700: an actor with no turn of its own to take: it cannot move and carries no motivation, so
 * the Actor never proposes anything for it. Its fields, regen and lifecycle still run.
 */
export function isInertActor(actor) {
  if (!actor || actor.capabilities?.canMove !== false) return false;
  if (Array.isArray(actor.motivations) && actor.motivations.length > 0) return false;
  return !actor.motivation?.kind;
}

/**
 * Which tracked actors stay awake for DECIDE this tick.
 *
 * @param {object} args
 * @param {string[]} args.actorIds — candidates (alive, not exited)
 * @param {Array<{ id: string, position?: { x: number, y: number } }>} args.actors — positions
 * @param {string} [args.focusActorId] — current controlled / player actor
 * @param {number} [args.radius] — Chebyshev radius (already resolved, or raw)
 * @param {string[]} [args.alwaysAwakeIds] — e.g. actors with explicit commands or strategies;
 *   these are kept even when inert (#700)
 * @returns {string[]} awake actor ids in the same relative order as `actorIds`
 */
export function filterAwakeActorIds({
  actorIds = [],
  actors = [],
  focusActorId,
  radius,
  alwaysAwakeIds = [],
} = {}) {
  const byId = new Map();
  for (const actor of Array.isArray(actors) ? actors : []) {
    if (actor && typeof actor.id === "string" && actor.id) byId.set(actor.id, actor);
  }
  const forced = new Set(
    (Array.isArray(alwaysAwakeIds) ? alwaysAwakeIds : [])
      .filter((id) => typeof id === "string" && id),
  );
  // Focus actor is always awake when present among candidates.
  if (typeof focusActorId === "string" && focusActorId) forced.add(focusActorId);
  // #700: inert actors drop out first, whatever the radius.
  const known = (Array.isArray(actorIds) ? actorIds : [])
    .filter((id) => typeof id === "string" && id && (forced.has(id) || !isInertActor(byId.get(id))));
  const wakeRadius = resolveActorHibernationRadius(radius);
  if (!Number.isFinite(wakeRadius)) return known;

  const focusPos = byId.get(focusActorId)?.position;
  // No usable focus position → keep everyone awake (fail open: alive level, not a silent stall).
  if (!focusPos || !Number.isInteger(focusPos.x) || !Number.isInteger(focusPos.y)) {
    return known;
  }

  return known.filter((id) => {
    if (forced.has(id)) return true;
    const actor = byId.get(id);
    if (!actor?.position) return true;
    return chebyshevTileDistance(focusPos, actor.position) <= wakeRadius;
  });
}
