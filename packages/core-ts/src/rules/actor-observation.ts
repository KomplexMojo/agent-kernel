import type { createActorRegistry } from '../state/actor-registry.ts';
import { projectActorFieldsFromSnapshot, resolveActorFieldOverlap } from './actor-fields.ts';
import { computeVisibleCells, NET_DARK_OBSCURE_INTENSITY_THRESHOLD, resolveNetLightDark,
  resolveVisibilityRadius, scopeObservation, SIGHT_LIGHT_EXPRESSION } from '../state/visibility.ts';
import type { ActorRecord, ActorRegistrySnapshot } from '../state/actor-types.ts';
import { litActorAffinities } from './actor-upkeep.ts';
import { RAISED_BARRIER_TILE_KIND } from './actor-cast.ts';
import { affinityTableRow } from '../state/affinity-table.ts';
import type { AffinityKind } from '../state/actor-types.ts';

/** Which table column (#416) a sight map reads: lit cells, revealed actors, darkened cells. */
type SightColumn = 'illuminates' | 'reveals' | 'conceals';
const hasColumn = (kind: string | undefined, column: SightColumn) =>
  kind !== undefined && affinityTableRow(kind as AffinityKind)?.[column] === true;
import { AFFINITY_EXPRESSION_BY_CODE, AFFINITY_KIND_BY_CODE } from '../affinity-readers.ts';
import { getOppositeAffinityKind } from '../state/affinity.ts';

/** Detached facts; reading an observation never applies exposure or advances time. */
export function readActorRegistryObservation(registry: Pick<ReturnType<typeof createActorRegistry>, 'snapshot'>, tick: number) {
  // One snapshot: field projection used to call registry.snapshot() again (2× copy cost).
  const snapshot = registry.snapshot();
  const { width, height } = snapshot.dimensions;
  const terrainKinds = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x): number =>
    snapshot.terrain[y * width + x] === 'wall' || snapshot.terrain[y * width + x] === 'spawn' ? 1 : 0));
  const movementKinds = terrainKinds.map(row => [...row]);
  const sightKinds = terrainKinds.map(row => [...row]);
  for (const actor of snapshot.actors) {
    if (actor.lifecycle !== 'alive') continue;
    // A raised barrier (#413) blocks now but erodes in time: its own kind, unless a wall is there too.
    if (actor.capabilities.blocksMovement && movementKinds[actor.position.y][actor.position.x] !== 1) {
      movementKinds[actor.position.y][actor.position.x] = actor.raisedBy !== undefined ? RAISED_BARRIER_TILE_KIND : 1;
    }
    if (actor.capabilities.blocksSight) sightKinds[actor.position.y][actor.position.x] = 1;
  }
  const projection = projectActorFieldsFromSnapshot(snapshot);
  return { tick, actors: snapshot.actors.map(actor => ({ ...actor })),
    tiles: { kinds: movementKinds }, sightKinds,
    affinityFields: projection.fields.map(field => ({ ...field })),
    affinityContributions: projection.contributions.map(field => ({ ...field })) };
}

type RegistryObservation = ReturnType<typeof readActorRegistryObservation>;

/**
 * Fog of war reads the affinity field (maintainer, 2026-10-17, #288): the light and
 * dark on a cell are the emitted light and dark fields there, after the field's own
 * opposite-pair cancellation, keyed `x,y` as the strongest surviving source's
 * intensity (#340: range is how far a field reaches, intensity is what beats dark).
 * There is one cancellation rule for sight, floor shading and every vital effect.
 * A source shines at full strength while its affinity is on and goes dark when it
 * drains (the generic switch-off), and light reaches as far as its field does.
 */
function fieldIntensityByCell(fields: readonly { kind: string; expression: string; intensity: number; falloff: number;
  position: { x: number; y: number } }[], column: SightColumn): Record<string, number> {
  const reached: Record<string, number> = {};
  for (const field of fields) {
    // A push's one-turn trail (#461) shines like an emitted field while it lasts.
    if (!hasColumn(field.kind, column) || (field.expression !== AFFINITY_EXPRESSION_BY_CODE[SIGHT_LIGHT_EXPRESSION]
      && field.expression !== 'push') || field.intensity <= 0 || field.falloff <= 0) continue;
    const key = `${field.position.x},${field.position.y}`;
    if (field.intensity > (reached[key] ?? 0)) reached[key] = field.intensity;
  }
  return reached;
}

/** Net emitted light intensity on each cell of a registry snapshot, from the field (#288). Read-only. */
export function readActorRegistryLightByCell(snapshot: ActorRegistrySnapshot): Record<string, number> {
  return fieldIntensityByCell(projectActorFieldsFromSnapshot(snapshot).fields, 'illuminates');
}

/** Net emitted dark intensity on each cell of a registry snapshot, from the field (#288). Read-only. */
export function readActorRegistryDarkByCell(snapshot: ActorRegistrySnapshot): Record<string, number> {
  return fieldIntensityByCell(projectActorFieldsFromSnapshot(snapshot).fields, 'conceals');
}

/** The range of the light an actor emits right now: its widest lit light emit slot, 0 if none. */
function litLightRange(actor: ActorRecord): number {
  if (actor.lifecycle !== 'alive') return 0;
  return Math.max(0, ...litActorAffinities(actor).filter(pair => hasColumn(pair.kind, 'illuminates')
    && pair.expression === AFFINITY_EXPRESSION_BY_CODE[SIGHT_LIGHT_EXPRESSION]).map(pair => pair.stacks));
}

/** Per-cell light against dark as the field leaves them. */
function resolveRegistryLightDark(observation: RegistryObservation) {
  const { width, height } = observation.sightKinds.length
    ? { width: observation.sightKinds[0].length, height: observation.sightKinds.length } : { width: 0, height: 0 };
  const darkByCell = fieldIntensityByCell(observation.affinityFields, 'conceals');
  return { width, height, darkByCell, ...resolveNetLightDark(fieldIntensityByCell(observation.affinityFields, 'illuminates'), darkByCell) };
}

/**
 * One observer's sight inputs. Its own light extends its radius by its range while
 * light survives the field's cancellation at its tile; cells where light survives
 * are lit; cells where dark survives are obscured, along with anyone standing in
 * them. The observer's own dark is left out of the field it sees by: dark obscures
 * everyone else, never the actor emitting it (#409, "own emit never affects self",
 * #336). Dark from other sources that still survives at its tile by the blinding
 * threshold leaves it its own tile only (#284).
 *
 * Dark stealth: an actor standing in its *own* concealing emit stays obscured to
 * others even when opposing light would cancel net dark on that tile for floor
 * shading (visibility.ts: own dark "hides the emitter"). Without this, equal-
 * intensity light that merely reaches the tile strips the cloak and stealth fails.
 */
function resolveRegistrySight(observation: RegistryObservation, self: ActorRecord) {
  const ownDark = isOwnDark(self.id);
  const { lightByCell, darkStacksByCell } = resolveLightDarkWithoutOwnDark(observation, self.id);
  cloakEmittersInOwnDark(observation, self.id, darkStacksByCell);
  const tile = `${self.position.x},${self.position.y}`;
  const ownLight = (lightByCell[tile] ?? 0) > 0 ? litLightRange(self) : 0;
  // Blinding dark (#284): the field at the tile re-resolved without the observer's own dark.
  const atTile = observation.affinityContributions.filter(cell => cell.position.x === self.position.x
    && cell.position.y === self.position.y && !ownDark(cell));
  const othersDark = fieldIntensityByCell(resolveActorFieldOverlap(atTile), 'conceals')[tile] ?? 0;
  return {
    radius: resolveVisibilityRadius({ lightStacks: ownLight, blindingDarkIntensity: othersDark }),
    options: { darkStacksByCell, lightByCell, darkObscureThreshold: NET_DARK_OBSCURE_INTENSITY_THRESHOLD },
  };
}

const isOwnDark = (selfId: string) => (cell: { sourceId?: string; kind?: string }) => cell.sourceId === selfId && hasColumn(cell.kind, 'conceals');

/**
 * Keep each living emitter's own concealing field on its tile visible to other
 * observers for concealment, when the light reaching that tile does not outweigh it.
 * A tie goes to the cloak (#709: equal light must not strip it); stronger light
 * still reveals the emitter, as dark against light is decided by strength (#203, #288).
 */
function cloakEmittersInOwnDark(
  observation: RegistryObservation,
  observerId: string,
  darkStacksByCell: Record<string, number>,
): void {
  for (const actor of observation.actors) {
    if (actor.id === observerId || actor.lifecycle !== 'alive') continue;
    const key = `${actor.position.x},${actor.position.y}`;
    const own = isOwnDark(actor.id);
    const atTile = observation.affinityContributions.filter(cell =>
      cell.position.x === actor.position.x && cell.position.y === actor.position.y);
    const onTile = atTile.filter(own);
    if (onTile.length === 0) continue;
    const intensity = fieldIntensityByCell(resolveActorFieldOverlap(onTile), 'conceals')[key] ?? 0;
    // The light reaching the tile before it meets the emitter's own dark.
    const light = fieldIntensityByCell(resolveActorFieldOverlap(atTile.filter(cell => !own(cell))), 'illuminates')[key] ?? 0;
    if (intensity >= NET_DARK_OBSCURE_INTENSITY_THRESHOLD && intensity >= light) {
      darkStacksByCell[key] = Math.max(darkStacksByCell[key] ?? 0, intensity);
    }
  }
}

/**
 * The field one actor lives by: without dark of its own the field as it stands; with some, the field
 * re-resolved from every contribution but its own dark (#409: own emit never affects self).
 */
function resolveLightDarkWithoutOwnDark(observation: RegistryObservation, selfId: string) {
  const ownDark = isOwnDark(selfId);
  if (!observation.affinityContributions.some(ownDark)) return resolveRegistryLightDark(observation);
  // The overlap resolves one cell's contributions at a time.
  const byCell = new Map<string, typeof observation.affinityContributions>();
  for (const cell of observation.affinityContributions) {
    if (ownDark(cell)) continue;
    const key = `${cell.position.x},${cell.position.y}`;
    byCell.set(key, [...(byCell.get(key) ?? []), cell]);
  }
  const others = [...byCell.values()].flatMap(cells => resolveActorFieldOverlap(cells));
  return resolveNetLightDark(fieldIntensityByCell(others, 'illuminates'), fieldIntensityByCell(others, 'conceals'));
}
/** Reuse the established radius/occlusion policy with independent sight capabilities. */
export function scopeActorRegistryObservation(observation: RegistryObservation, actorId: string) {
  const self = observation.actors.find(actor => actor.id === actorId);
  if (!self) return { ...observation, actors: [], affinityFields: [], affinityContributions: [] };
  const { radius, options } = resolveRegistrySight(observation, self);
  const scoped = scopeObservation({ ...observation, tiles: { kinds: observation.sightKinds } }, actorId, radius, options);
  const contributions = scopeObservation({ ...observation, affinityFields: observation.affinityContributions,
    tiles: { kinds: observation.sightKinds } }, actorId, radius, options);
  // The observer walks through the barriers it raised (#413); anything else blocking there still counts.
  const own = observation.actors.filter(actor => actor.lifecycle === 'alive' && actor.raisedBy === actorId);
  const kinds = own.length ? observation.tiles.kinds.map(row => [...row]) : observation.tiles.kinds;
  for (const barrier of own) {
    const { x, y } = barrier.position;
    if (kinds[y][x] === RAISED_BARRIER_TILE_KIND && !observation.actors.some(other => other.lifecycle === 'alive'
      && other.id !== barrier.id && other.raisedBy !== actorId && other.id !== actorId
      && other.capabilities.blocksMovement && other.position.x === x && other.position.y === y)) kinds[y][x] = 0;
  }
  return { ...scoped, tiles: own.length ? { kinds } : observation.tiles, affinityContributions: contributions.affinityFields };
}

/** #718: one hit an actor felt: what struck it and how (a hit reveals its affinity, #497). */
export interface ActorReceivedHit {
  tick: number;
  event: 'cast' | 'field';
  kind: string;
  expression: string;
  /** Present only when the receiver can see the source in its own scoped observation. */
  sourceId?: string;
}

interface ReceivedTurn {
  tick: number;
  casts?: readonly { sourceId: string; kind: string; expression: string; targetId?: string;
    changes: readonly { actorId: string; vital?: string; delta: number }[] }[];
  fieldContacts?: readonly { sourceId: string; targetId: string; kind: string; expression: string;
    changes: readonly { actorId: string; delta: number }[] }[];
}

/**
 * #718: what struck one actor on the last applied turn, as that actor felt it: another's cast
 * or a lasting field that took one of its vitals. Only the receiver's own hits, never anyone
 * else's; the kind and expression are what the hit revealed (#497), and the source is named
 * only when it is in `scoped` (the receiver's own observation, `scopeActorRegistryObservation`).
 * One entry per source, event, kind and expression, in the turn's order.
 */
export function readActorReceivedHits(turn: ReceivedTurn | null | undefined, actorId: string,
  scoped: { actors: readonly { id: string }[] }): ActorReceivedHit[] {
  if (!turn) return [];
  const seen = new Set(scoped.actors.map(actor => actor.id));
  const tookFrom = (changes: readonly { actorId: string; delta: number }[]) =>
    changes.some(change => change.actorId === actorId && change.delta < 0);
  const hits: ActorReceivedHit[] = [];
  const keys = new Set<string>();
  const add = (event: 'cast' | 'field', entry: { sourceId: string; kind: string; expression: string }) => {
    const key = `${entry.sourceId}:${event}:${entry.kind}:${entry.expression}`;
    if (keys.has(key)) return;
    keys.add(key);
    hits.push({ tick: turn.tick, event, kind: entry.kind, expression: entry.expression,
      ...(seen.has(entry.sourceId) ? { sourceId: entry.sourceId } : {}) });
  };
  for (const cast of turn.casts ?? []) {
    if (cast.sourceId !== actorId && cast.targetId === actorId && tookFrom(cast.changes)) add('cast', cast);
  }
  for (const contact of turn.fieldContacts ?? []) {
    if (contact.sourceId !== actorId && contact.targetId === actorId && tookFrom(contact.changes)) add('field', contact);
  }
  return hits;
}

/** #758: one cast an actor made last turn and whether it hurt what it struck. */
export interface ActorDealtCast {
  tick: number;
  targetId: string;
  kind: string;
  expression: string;
  /** The struck actor lost health or durability: progress toward a defeat. */
  harmed: boolean;
}

const DEFEAT_PATH_VITALS = new Set(['health', 'durability']);

/**
 * #758: what an actor's own casts did on the last applied turn, as the caster saw them land
 * (#497: an interaction shows its outcome; the narration says "it looks unhurt"). One entry per
 * cast that struck another actor, in the turn's order; `harmed` is whether that actor lost health
 * or durability. A mana or stamina drain is not harm toward a defeat.
 */
export function readActorDealtCasts(turn: ReceivedTurn | null | undefined, actorId: string): ActorDealtCast[] {
  if (!turn) return [];
  return (turn.casts ?? [])
    .filter(cast => cast.sourceId === actorId && typeof cast.targetId === 'string' && cast.targetId !== actorId)
    .map(cast => ({
      tick: turn.tick, targetId: cast.targetId as string, kind: cast.kind, expression: cast.expression,
      harmed: cast.changes.some(change => change.actorId === cast.targetId && change.delta < 0
        && DEFEAT_PATH_VITALS.has(String(change.vital))),
    }));
}

/**
 * The map half of fog of war for one actor, right now: a grid the map's shape,
 * 1 visible / 0 not, by the same rule as scoping. `[]` when the actor is not on
 * the map. Remembering explored cells is the caller's session state.
 */
export function readActorRegistryVisibleCells(observation: RegistryObservation, actorId: string): number[][] {
  const self = observation.actors.find(actor => actor.id === actorId);
  if (!self || self.lifecycle === 'exited') return [];
  const { radius, options } = resolveRegistrySight(observation, self);
  return computeVisibleCells(observation.sightKinds, self.position, radius, options);
}

/**
 * How much of each other living actor `observerId` can read right now (#416, Darren
 * 2026-10-18): the net intensity of revealing fields on the actor's cell after concealing
 * ones cancel them, 0 when nothing reveals it or concealment wins. Any property above the
 * level reads as the level with a `+`; at 0 only its glyph and role show. An actor's own
 * concealing field hides it from others; the observer's own never hides anyone from it,
 * as it never darkens its own sight (#409). Whether the observer sees the actor at all is
 * sight's call; this does not say. Who counts as one's own party is the caller's.
 */
export function readActorRegistryRevealLevels(observation: RegistryObservation, observerId: string): Record<string, number> {
  const byCell = new Map<string, typeof observation.affinityContributions>();
  for (const cell of observation.affinityContributions) {
    if (cell.sourceId === observerId && hasColumn(cell.kind, 'conceals')) continue;
    const key = `${cell.position.x},${cell.position.y}`;
    byCell.set(key, [...(byCell.get(key) ?? []), cell]);
  }
  const fields = [...byCell.values()].flatMap(cells => resolveActorFieldOverlap(cells));
  const { lightByCell } = resolveNetLightDark(fieldIntensityByCell(fields, 'reveals'), fieldIntensityByCell(fields, 'conceals'));
  return Object.fromEntries(observation.actors
    .filter(actor => actor.id !== observerId && actor.lifecycle === 'alive')
    .map(actor => [actor.id, lightByCell[`${actor.position.x},${actor.position.y}`] ?? 0]));
}

/** One equipped affinity as an observer reads it (#564): kind and expression, intensity capped by the reveal level. */
export interface ActorAffinityReading { kind: string; expression: string; intensity: number | `${number}+` }

/**
 * What `observerId` can read of each other living actor's equipped affinities right now (#564):
 * only actors a revealing field reaches (reveal level 1 or more), each entry's intensity capped
 * by that level as `revealedValue` does. An actor nothing reveals is absent: the observer learns
 * nothing from standing near it. Same hidden-information cap as the player's view (#497).
 */
export function readActorRegistryReadings(observation: RegistryObservation, observerId: string): Record<string, ActorAffinityReading[]> {
  const levels = readActorRegistryRevealLevels(observation, observerId);
  const readings: Record<string, ActorAffinityReading[]> = {};
  for (const actor of observation.actors) {
    const level = levels[actor.id] ?? 0;
    if (level < 1 || actor.id === observerId) continue;
    const entries = (actor.affinities ?? []).map(entry => ({
      kind: String(entry.kind), expression: String(entry.expression), intensity: revealedValue(entry.intensity ?? 1, level) }));
    if (entries.length > 0) readings[actor.id] = entries;
  }
  return readings;
}

/** The opposed kind of a named affinity kind (core's one table), or null when it has none. */
export function readOppositeAffinityKind(kind: string): string | null {
  const code = Number(Object.keys(AFFINITY_KIND_BY_CODE).find(key => AFFINITY_KIND_BY_CODE[Number(key)] === kind));
  return Number.isInteger(code) ? (AFFINITY_KIND_BY_CODE[getOppositeAffinityKind(code)] ?? null) : null;
}

/** A property's value as an observer at reveal `level` reads it (#416): above the level, `level+`. */
export function revealedValue(value: number, level: number): number | `${number}+` {
  return value > level ? `${level}+` : value;
}

/**
 * Where dark outweighs light right now: a grid the map's shape, 1 dark / 0 not.
 * A remembered map is invalidated wherever this is 1 (#203); the caller keeps
 * the memory, core only says where the dark is.
 */
export function readActorRegistryDarkCells(observation: RegistryObservation, actorId?: string): number[][] {
  // For one actor (its memory): its own dark never erases what it remembers (Darren, 2026-10-30).
  const { width, height } = resolveRegistryLightDark(observation);
  const { darkStacksByCell } = actorId === undefined ? resolveRegistryLightDark(observation) : resolveLightDarkWithoutOwnDark(observation, actorId);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    (darkStacksByCell[`${x},${y}`] ?? 0) >= NET_DARK_OBSCURE_INTENSITY_THRESHOLD ? 1 : 0));
}

/** One affinity's net presence on a cell: what survives opposite-kind cancellation there. */
export interface FieldCellReading { kind: string; stacks: number; intensity: number; falloff: number; sources: string[] }

/**
 * Every affinity field on each cell right now, for every kind alike (#287): a
 * grid the map's shape, each cell the emitted (emit/push) fields that survive
 * there after opposite pairs cancel, strongest first. Read from the field
 * projection the tick uses (`affinityFields`), never recomputed.
 */
/** What a field does on a tile: its falloff times intensity squared, the same scale as its effect. */
const strength = (reading: Pick<FieldCellReading, 'intensity' | 'falloff'>) => reading.falloff * reading.intensity * reading.intensity;

export function readActorRegistryFieldCells(observation: RegistryObservation): FieldCellReading[][][] {
  const height = observation.sightKinds.length;
  const width = height ? observation.sightKinds[0].length : 0;
  const grid: FieldCellReading[][][] = Array.from({ length: height }, () => Array.from({ length: width }, () => []));
  for (const field of observation.affinityFields) {
    const { x, y } = field.position;
    if (field.expression === 'draw' || field.falloff <= 0 || !grid[y]?.[x]) continue;
    const cell = grid[y][x];
    const existing = cell.find(entry => entry.kind === field.kind);
    const reading = { stacks: field.stacks, intensity: field.intensity, falloff: field.falloff };
    // #485: who emits it, so a reader can tell a field that acts on you from your own (which never does).
    if (!existing) cell.push({ kind: field.kind, ...reading, sources: [field.sourceId] });
    else {
      if (!existing.sources.includes(field.sourceId)) existing.sources.push(field.sourceId);
      if (strength(reading) > strength(existing)) Object.assign(existing, reading);
    }
  }
  for (const row of grid) for (const cell of row) cell.sort((a, b) => strength(b) - strength(a) || (a.kind < b.kind ? -1 : 1));
  return grid;
}
