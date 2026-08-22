/**
 * DS.3 — how far an actor can see, and what that hides from it.
 *
 * THE RULE (maintainer, 2026-08-20). An actor with no affinities, in a room with
 * no hazards, sees 3 tiles in each direction. Affinity interactions decide the
 * rest at runtime: emitted dark obscures, emitted light extends.
 *
 * WHY THE NUMBERS ARE NOT NEW — AND WHY THEY MOVED HERE.
 * `DARKNESS_OBSCURE_STACK_THRESHOLD`, `DARKNESS_OBSCURE_RADIUS` and
 * `LIGHT_SIGHT_MIN_STACK` were declared in `runtime/src/contracts/
 * domain-constants.js` and then read by nothing, anywhere, ever — dead since the
 * commit that introduced them. They encode exactly this design, so DS.3 consumes
 * them rather than inventing a parallel scale beside them; two vocabularies for
 * one concept is how this codebase grew two affinity authorities once already
 * (F10). They live HERE now because the mechanism is core's and **core-ts must
 * never import from runtime** — the dependency direction is one-way and a
 * violation is blocking. Runtime's copies were deleted, not aliased, so there is
 * exactly one origin.
 *
 * WHY STACKS AND NOT INTENSITY. The field stores both. Intensity is
 * distance-attenuated and would give a softer, more physical falloff — that was
 * this milestone's first design. It was dropped in favour of the constants
 * above, which are stack-denominated: honouring the names that already exist
 * beats a better-looking scale that makes them dead a second time. The
 * consequence is deliberate and is pinned by a test: the rule is a step
 * function, so the edge of a dark aura obscures exactly as much as its heart.
 *
 * WHAT THIS MODULE DOES NOT DO. It reads the affinity field; it never recomputes
 * it and never re-derives light/dark opposition. `computeAffinityField()` runs
 * `applyOppositeAffinityFieldCancellation()` internally, so by the time anything
 * reads a cell, at most one of {Light, Dark} survives there — the stronger has
 * already consumed the weaker. Re-deriving that here would double-count it.
 */
import { AffinityKind } from "./affinity.ts";

/** Sight for an actor with no light or dark in play: 3 tiles in each direction. */
export const BASELINE_SIGHT_RADIUS = 3;

/** At or above this many surviving dark stacks, sight collapses. Was dead in runtime. */
export const DARKNESS_OBSCURE_STACK_THRESHOLD = 2;

/** What sight collapses TO under darkness. Was dead in runtime. */
export const DARKNESS_OBSCURE_RADIUS = 1;

/** Light below this many stacks does not extend sight at all. Was dead in runtime. */
export const LIGHT_SIGHT_MIN_STACK = 1;

/**
 * Tiles of extra sight per surviving light stack.
 *
 * ⚠️ The ONLY genuinely new number here. The three constants above cover
 * darkness and gate light, but nothing ever defined how far light actually
 * reaches — `LIGHT_SIGHT_MIN_STACK` is a threshold with no matching effect. This
 * is that missing half, named rather than inlined so it is tunable as data.
 */
export const LIGHT_SIGHT_BONUS_PER_STACK = 1;

/**
 * The floor clamp, ruled 2026-08-20: an actor always perceives what is adjacent.
 *
 * A radius of 0 would leave an actor unable to see an attacker standing next to
 * it, collapsing every hostile-dependent proposal to `wait` and turning a dark
 * room into a dead zone rather than a dangerous one.
 */
export const MIN_SIGHT_RADIUS = 1;

function asStackCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

export interface VisibilityStacks {
  lightStacks?: number;
  darkStacks?: number;
}

/**
 * The sight radius implied by the light and dark surviving at one cell.
 *
 * Pure and total: any malformed input resolves to the baseline rather than to a
 * nonsense radius, because a thrown error here would take down the tick and a
 * zero would silently blind an actor.
 *
 * Dark is checked first. Core's cancellation means both should never be present
 * at once, but the order is fixed rather than incidental so the answer stays
 * deterministic even if that invariant is ever weakened — replay compares runs
 * frame by frame.
 */
export function resolveVisibilityRadius(stacks: VisibilityStacks): number {
  const dark = asStackCount(stacks?.darkStacks);
  const light = asStackCount(stacks?.lightStacks);

  if (dark >= DARKNESS_OBSCURE_STACK_THRESHOLD) {
    return Math.max(MIN_SIGHT_RADIUS, DARKNESS_OBSCURE_RADIUS);
  }
  if (light >= LIGHT_SIGHT_MIN_STACK) {
    return BASELINE_SIGHT_RADIUS + light * LIGHT_SIGHT_BONUS_PER_STACK;
  }
  // Dark below the threshold deliberately does nothing: the threshold IS the
  // rule, not the start of a slope. A partial dimming would be a new design, not
  // a reading of the constants this milestone agreed to consume.
  return Math.max(MIN_SIGHT_RADIUS, BASELINE_SIGHT_RADIUS);
}

/** The two field kinds that bear on sight. Every other affinity is irrelevant to it. */
export const SIGHT_AFFINITY_KINDS = Object.freeze({
  LIGHT: AffinityKind.Light,
  DARK: AffinityKind.Dark,
});

export interface VisibilityObservationActor {
  id?: string;
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface VisibilityObservation {
  actors?: VisibilityObservationActor[];
  [key: string]: unknown;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Narrow an observation to what one observer can actually perceive.
 *
 * Chebyshev distance, because "3 tiles in each direction" describes a square —
 * and because every other distance computation in this codebase is already
 * Chebyshev (core's push/pull range rule, the Actor's nearest-hostile search).
 *
 * ⚠️ **Refuses rather than guesses.** If the observer cannot be located in the
 * actor list, the observation is returned UNCHANGED. Returning an empty list
 * would be the "safe-looking" choice and is far worse: it silently blinds an
 * actor, and a blinded actor still acts — it just acts on nothing.
 *
 * Pure: the input is never mutated. The observer itself is always retained,
 * at any radius.
 */
export function scopeObservation<T extends VisibilityObservation>(
  observation: T,
  observerId: string,
  radius: number,
): T {
  if (!observation || !Array.isArray(observation.actors)) return observation;

  const observer = observation.actors.find((actor) => actor?.id === observerId);
  const origin = observer?.position;
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
    return observation;
  }

  const effectiveRadius = Math.max(
    MIN_SIGHT_RADIUS,
    typeof radius === "number" && Number.isFinite(radius) ? Math.trunc(radius) : BASELINE_SIGHT_RADIUS,
  );

  const actors = observation.actors.filter((actor) => {
    if (actor?.id === observerId) return true;
    const position = actor?.position;
    // An actor with no position cannot be placed, so it cannot be ruled out of
    // sight either. Keep it: dropping it would hide it on a technicality.
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return true;
    return chebyshev(origin, position) <= effectiveRadius;
  });

  return { ...observation, actors } as T;
}
