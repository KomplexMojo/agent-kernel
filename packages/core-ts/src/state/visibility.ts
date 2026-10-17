/**
 * DS.3/DS6.1 — how far an actor can see and what occlusion/concealment hides.
 *
 * THE RULE (maintainer, 2026-10-10; supersedes the 3-tile baseline of
 * 2026-08-20). Levels are UNLIT. An actor that does not itself emit light sees
 * only what is adjacent. Light the actor emits extends its sight radius. Light
 * anything emits (a hazard, another actor, the observer itself) makes the cells
 * it reaches LIT, and a lit cell is seen from any distance in line of sight,
 * along with whatever stands in it (ruled 2026-10-10: "this would also include
 * hazards that emit light"). Dark interacts through the affinity field:
 * opposite-kind cancellation wears the actor's own light down at its tile, and
 * any cell where dark survives at the obscure threshold is neither lit nor seen
 * into from beyond one tile.
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
 * MANA. A light or dark source works like every lasting affinity (#288,
 * maintainer 2026-10-17): it shines its full stacks while switched on and goes
 * dark when it cannot pay its upkeep, until its mana is full again. The field
 * projection already leaves switched-off sources out, so nothing here reads mana.
 *
 * WHAT THIS MODULE DOES NOT DO. It reads the affinity field; it never recomputes
 * it and never re-derives light/dark opposition. `computeAffinityField()` runs
 * `applyOppositeAffinityFieldCancellation()` internally, so by the time anything
 * reads a cell, at most one of {Light, Dark} survives there — the stronger has
 * already consumed the weaker. Re-deriving that here would double-count it.
 */
import { AffinityExpression, AffinityKind } from "./affinity.ts";

/**
 * Sight for an actor that emits no light: what is adjacent. Was 3 until the
 * unlit-level ruling of 2026-10-10.
 */
export const BASELINE_SIGHT_RADIUS = 1;

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
 * The floor clamp for ordinary dark, ruled 2026-08-20: an actor always perceives
 * what is adjacent. Only blinding dark (below) goes under it.
 *
 * A radius of 0 leaves an actor unable to see an attacker standing next to it,
 * collapsing every hostile-dependent proposal to `wait`. That is a dead zone in
 * an ordinary dark room, so weaker dark keeps this floor.
 */
export const MIN_SIGHT_RADIUS = 1;

/**
 * Blinding dark (maintainer, 2026-10-15, #284): when the dark OTHER sources
 * cast on an actor's tile outweighs the light there by this many stacks, the
 * actor sees only its own tile (`BLIND_SIGHT_RADIUS`). Lit cells further off
 * stay visible in line of sight. Every actor is under the same rule, so strong
 * dark is also a way to slip past a warden.
 *
 * The actor's own dark does not count: it hides the emitter, it does not blind
 * it, or every dark-bearer above one stack would blind itself.
 */
export const BLINDING_DARK_STACK_THRESHOLD = 2;

/** What sight collapses to under blinding dark: the actor's own tile. */
export const BLIND_SIGHT_RADIUS = 0;

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
  /** Light the OBSERVER emits that survives cancellation at its own tile. */
  lightStacks?: number;
  /** Dark surviving at the observer's tile. */
  darkStacks?: number;
  /**
   * Net dark from other sources at the observer's tile, after the light there
   * (#284). At `BLINDING_DARK_STACK_THRESHOLD` or more the observer is blind.
   */
  blindingDarkStacks?: number;
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

  if (asStackCount(stacks?.blindingDarkStacks) >= BLINDING_DARK_STACK_THRESHOLD) {
    return BLIND_SIGHT_RADIUS;
  }
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

/**
 * Dark against light, by stacks (maintainer, 2026-10-12, #203): "the dark
 * affinity keeps a character and area dark based on the affinity stack as
 * compared to countering affinity stacks like light." Per cell, the strongest
 * emitted dark reaching it is weighed against the strongest emitted light:
 * the difference is what survives. More dark leaves net dark, more light
 * leaves net light, a tie leaves neither.
 *
 * One net dark stack darkens a cell (`NET_DARK_OBSCURE_STACK_THRESHOLD`), so
 * every stack of light invested counters exactly one stack of dark. The
 * 2-stack `DARKNESS_OBSCURE_STACK_THRESHOLD` remains for the legacy world
 * path, which reads intensity-cancelled field stacks rather than this
 * comparison.
 */
export const NET_DARK_OBSCURE_STACK_THRESHOLD = 1;

export interface NetLightDark {
  /** Light stacks left after the dark at the same cell is subtracted, keyed `x,y`. */
  lightByCell: Record<string, number>;
  /** Dark stacks left after the light at the same cell is subtracted, keyed `x,y`. */
  darkStacksByCell: Record<string, number>;
}

export function resolveNetLightDark(
  lightByCell: Readonly<Record<string, number>>,
  darkByCell: Readonly<Record<string, number>>,
): NetLightDark {
  const net: NetLightDark = { lightByCell: {}, darkStacksByCell: {} };
  for (const key of new Set([...Object.keys(lightByCell), ...Object.keys(darkByCell)])) {
    const difference = asStackCount(lightByCell[key]) - asStackCount(darkByCell[key]);
    if (difference > 0) net.lightByCell[key] = difference;
    else if (difference < 0) net.darkStacksByCell[key] = -difference;
  }
  return net;
}

/** Only light the observer EMITS lights its way; push and pull do not. */
export const SIGHT_LIGHT_EXPRESSION = AffinityExpression.Emit;

/**
 * The light an observer contributes to its own sight.
 *
 * Its own emitted stacks, capped by what survives at its tile after the field's
 * light/dark cancellation. The cap is the dark interaction: a dark source strong
 * enough to win at the actor's tile leaves nothing. The cap also stops light
 * from another source standing in for the actor's own, because an actor that
 * emits nothing contributes zero whatever the field holds.
 */
export function resolveOwnSightLight(ownEmittedStacks: number, survivingLightStacks: number): number {
  return Math.min(asStackCount(ownEmittedStacks), asStackCount(survivingLightStacks));
}

export interface VisibilityObservationActor {
  id?: string;
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface VisibilityObservationHazard {
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface VisibilityObservationAffinityField {
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface VisibilityObservation {
  actors?: VisibilityObservationActor[];
  hazards?: VisibilityObservationHazard[];
  affinityFields?: VisibilityObservationAffinityField[];
  tiles?: { kinds?: unknown[][]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface VisibilityScopeOptions {
  /** Dark stacks at or above which a cell is obscured; `DARKNESS_OBSCURE_STACK_THRESHOLD` by default. */
  darkObscureThreshold?: number;
  /** Surviving dark stacks keyed as `x,y`, read from core's affinity field. */
  darkStacksByCell?: Readonly<Record<string, number>>;
  /** Emitted light reaching each cell, keyed as `x,y`, from core's `readLightLevels`. */
  lightByCell?: Readonly<Record<string, number>>;
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

function resolveDarkThreshold(value: unknown): number {
  return asStackCount(value) || DARKNESS_OBSCURE_STACK_THRESHOLD;
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

/**
 * Whether a cell is lit: emitted light reaches it at or above the minimum
 * stack, and dark has not won there. Light makes a cell visible from any
 * distance the observer has line of sight to (a lit room down a corridor is
 * seen), so the light's own reach (`readLightLevels`) is the only bound.
 */
function isLitCell(lightLevel: number, darkStacks: number, darkThreshold: number): boolean {
  return lightLevel >= LIGHT_SIGHT_MIN_STACK && darkStacks < darkThreshold;
}

function isPerceived(
  origin: { x: number; y: number },
  position: { x: number; y: number },
  radius: number,
  tileKinds: number[][] | null,
  darkStacksByCell: Readonly<Record<string, number>>,
  lightByCell: Readonly<Record<string, number>> = {},
  darkThreshold: number = DARKNESS_OBSCURE_STACK_THRESHOLD,
): boolean {
  const key = `${position.x},${position.y}`;
  const distance = chebyshev(origin, position);
  const targetDark = asStackCount(darkStacksByCell[key]);
  const lit = isLitCell(asStackCount(lightByCell[key]), targetDark, darkThreshold);
  if (distance > radius && !lit) return false;
  if (targetDark >= darkThreshold && distance > DARKNESS_OBSCURE_RADIUS) {
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

  // Callers resolve the radius (`resolveVisibilityRadius`); only blinding dark
  // takes it under `MIN_SIGHT_RADIUS`, so the clamp here is the blind floor.
  const effectiveRadius = Math.max(
    BLIND_SIGHT_RADIUS,
    typeof radius === "number" && Number.isFinite(radius) ? Math.trunc(radius) : BASELINE_SIGHT_RADIUS,
  );
  const tileKinds = resolveTileKinds(observation);
  const darkStacksByCell = options.darkStacksByCell ?? {};
  const lightByCell = options.lightByCell ?? {};
  const darkThreshold = resolveDarkThreshold(options.darkObscureThreshold);

  const actors = observation.actors.filter((actor) => {
    if (actor?.id === observerId) return true;
    const position = actor?.position;
    // An actor with no position cannot be placed, so it cannot be ruled out of
    // sight either. Keep it: dropping it would hide it on a technicality.
    if (!isGridPosition(position)) return true;
    return isPerceived(origin, position, effectiveRadius, tileKinds, darkStacksByCell, lightByCell, darkThreshold);
  });

  // Field cells are environmental facts, not target entities. They share the
  // same radius/LOS boundary but deliberately do not apply target-dark
  // concealment, which would hide the condition of a cell along with a source
  // actor standing in it.
  const affinityFields = Array.isArray(observation.affinityFields)
    ? observation.affinityFields.filter((field) => {
      const position = field?.position;
      if (!isGridPosition(position)) return false;
      return isPerceived(origin, position, effectiveRadius, tileKinds, {}, lightByCell, darkThreshold);
    })
    : observation.affinityFields;

  const scoped = {
    ...observation,
    actors,
    ...(Array.isArray(observation.affinityFields) ? { affinityFields } : {}),
  } as T;
  delete scoped.hazards;
  return scoped;
}

export interface VisibleCellsOptions {
  /** Dark stacks at or above which a cell is obscured; `DARKNESS_OBSCURE_STACK_THRESHOLD` by default. */
  darkObscureThreshold?: number;
  /** Surviving dark stacks keyed as `x,y`, read from core's affinity field. */
  darkStacksByCell?: Readonly<Record<string, number>>;
  /** Emitted light reaching each cell, keyed as `x,y`, from core's `readLightLevels`. */
  lightByCell?: Readonly<Record<string, number>>;
}

/**
 * Which tiles one observer can see: the map half of fog of war.
 *
 * Returns a grid the shape of `tileKinds`, 1 where visible and 0 where not. A
 * tile uses the same rule as an actor or hazard standing on it: within the
 * observer's radius or lit, in line of sight, and not concealed by dark. Concealment applies to tiles (unlike field cells
 * in `scopeObservation`) because a cell the dark has won is exactly what the
 * player should not be able to see into.
 *
 * Remembering explored tiles is NOT done here. That is session state across
 * ticks, and this function is a pure reading of one moment.
 *
 * Malformed geometry yields `[]`; an observer off the grid sees nothing.
 */
export function computeVisibleCells(
  tileKinds: number[][],
  origin: { x: number; y: number },
  radius: number,
  options: VisibleCellsOptions = {},
): number[][] {
  const kinds = resolveTileKinds({ tiles: { kinds: tileKinds } });
  if (!kinds) return [];
  const height = kinds.length;
  const width = kinds[0].length;
  const grid = kinds.map((row) => row.map(() => 0));
  if (!isGridPosition(origin) || origin.x < 0 || origin.y < 0 || origin.x >= width || origin.y >= height) {
    return grid;
  }
  // Callers resolve the radius (`resolveVisibilityRadius`); only blinding dark
  // takes it under `MIN_SIGHT_RADIUS`, so the clamp here is the blind floor.
  const effectiveRadius = Math.max(
    BLIND_SIGHT_RADIUS,
    typeof radius === "number" && Number.isFinite(radius) ? Math.trunc(radius) : BASELINE_SIGHT_RADIUS,
  );
  const darkStacksByCell = options.darkStacksByCell ?? {};
  const lightByCell = options.lightByCell ?? {};
  const darkThreshold = resolveDarkThreshold(options.darkObscureThreshold);
  // The whole grid, not just the radius box: a lit cell is visible from afar.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPerceived(origin, { x, y }, effectiveRadius, kinds, darkStacksByCell, lightByCell, darkThreshold)) grid[y][x] = 1;
    }
  }
  grid[origin.y][origin.x] = 1;
  return grid;
}
