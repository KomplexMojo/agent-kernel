/**
 * DS.3/DS6.1 — how far an actor can see and what occlusion/concealment hides.
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

/**
 * `readObservation().tiles.kinds` carries core tile-ACTOR kinds, not raw Tile
 * codes: stationary/walkable is 0 and both walls and barriers are 1.
 */
const OPAQUE_OBSERVATION_TILE_KIND = 1;

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

export interface VisibilityObservationHazard {
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface VisibilityObservation {
  actors?: VisibilityObservationActor[];
  hazards?: VisibilityObservationHazard[];
  tiles?: { kinds?: unknown[][]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface VisibilityScopeOptions {
  /** Surviving dark stacks keyed as `x,y`, read from core's affinity field. */
  darkStacksByCell?: Readonly<Record<string, number>>;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isGridPosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const position = value as { x?: unknown; y?: unknown };
  return Number.isInteger(position.x) && Number.isInteger(position.y);
}

function resolveTileKinds(observation: VisibilityObservation): number[][] | null {
  const kinds = observation.tiles?.kinds;
  if (!Array.isArray(kinds) || kinds.length === 0) return null;
  const width = Array.isArray(kinds[0]) ? kinds[0].length : 0;
  if (width === 0) return null;
  if (!kinds.every((row) => (
    Array.isArray(row)
    && row.length === width
    && row.every((kind) => typeof kind === "number" && Number.isFinite(kind))
  ))) {
    return null;
  }
  return kinds as number[][];
}

function isOpaqueTile(kind: unknown): boolean {
  return kind === OPAQUE_OBSERVATION_TILE_KIND;
}

/**
 * Whether two grid cells have an unobstructed deterministic supercover ray.
 *
 * A ray that crosses an exact corner checks both side-adjacent cells. That
 * deliberately forbids diagonal corner peeking. The target cell is excluded:
 * an opaque cell is itself perceptible while anything behind it is not.
 */
function hasLineOfSight(
  tileKinds: number[][],
  origin: { x: number; y: number },
  target: { x: number; y: number },
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let x = origin.x;
  let y = origin.y;
  let ix = 0;
  let iy = 0;

  const blocked = (cellX: number, cellY: number): boolean => {
    if (cellX === target.x && cellY === target.y) return false;
    return isOpaqueTile(tileKinds[cellY]?.[cellX]);
  };

  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      if (blocked(x + stepX, y) || blocked(x, y + stepY)) return false;
      x += stepX;
      y += stepY;
      ix += 1;
      iy += 1;
    } else if (decision < 0) {
      x += stepX;
      ix += 1;
    } else {
      y += stepY;
      iy += 1;
    }
    if (blocked(x, y)) return false;
  }
  return true;
}

function isPerceived(
  origin: { x: number; y: number },
  position: { x: number; y: number },
  radius: number,
  tileKinds: number[][] | null,
  darkStacksByCell: Readonly<Record<string, number>>,
): boolean {
  const distance = chebyshev(origin, position);
  if (distance > radius) return false;
  const targetDark = asStackCount(darkStacksByCell[`${position.x},${position.y}`]);
  if (targetDark >= DARKNESS_OBSCURE_STACK_THRESHOLD && distance > DARKNESS_OBSCURE_RADIUS) {
    return false;
  }
  return tileKinds ? hasLineOfSight(tileKinds, origin, position) : true;
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
 * When a complete tile-actor grid is present, kind 1 (wall or barrier) blocks a
 * deterministic supercover ray. Surviving target dark at the established
 * threshold limits detection to the established obscured radius. Actors and
 * hazards share the rule; missing geometry preserves radius-only behavior.
 *
 * Pure: the input is never mutated. The observer itself is always retained, at
 * any radius.
 */
export function scopeObservation<T extends VisibilityObservation>(
  observation: T,
  observerId: string,
  radius: number,
  options: VisibilityScopeOptions = {},
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
  const tileKinds = resolveTileKinds(observation);
  const darkStacksByCell = options.darkStacksByCell ?? {};

  const actors = observation.actors.filter((actor) => {
    if (actor?.id === observerId) return true;
    const position = actor?.position;
    // An actor with no position cannot be placed, so it cannot be ruled out of
    // sight either. Keep it: dropping it would hide it on a technicality.
    if (!isGridPosition(position)) return true;
    return isPerceived(origin, position, effectiveRadius, tileKinds, darkStacksByCell);
  });

  const hazards = Array.isArray(observation.hazards)
    ? observation.hazards.filter((hazard) => {
      const position = hazard?.position;
      if (!isGridPosition(position)) return true;
      return isPerceived(origin, position, effectiveRadius, tileKinds, darkStacksByCell);
    })
    : observation.hazards;

  return {
    ...observation,
    actors,
    ...(Array.isArray(observation.hazards) ? { hazards } : {}),
  } as T;
}
