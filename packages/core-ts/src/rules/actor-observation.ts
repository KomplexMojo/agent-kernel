import type { createActorRegistry } from '../state/actor-registry.ts';
import { projectActorFields, resolveActorFieldOverlap } from './actor-fields.ts';
import { computeVisibleCells, NET_DARK_OBSCURE_STACK_THRESHOLD, resolveNetLightDark, resolveOwnSightLight,
  resolveVisibilityRadius, scopeObservation, SIGHT_LIGHT_EXPRESSION } from '../state/visibility.ts';
import type { ActorRecord, ActorRegistrySnapshot } from '../state/actor-types.ts';
import { litActorAffinities } from './actor-upkeep.ts';
import { AFFINITY_EXPRESSION_BY_CODE } from '../affinity-readers.ts';

/** Detached facts; reading an observation never applies exposure or advances time. */
export function readActorRegistryObservation(registry: Pick<ReturnType<typeof createActorRegistry>, 'snapshot'>, tick: number) {
  const snapshot = registry.snapshot();
  const { width, height } = snapshot.dimensions;
  const terrainKinds = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    snapshot.terrain[y * width + x] === 'wall' || snapshot.terrain[y * width + x] === 'spawn' ? 1 : 0));
  const movementKinds = terrainKinds.map(row => [...row]);
  const sightKinds = terrainKinds.map(row => [...row]);
  for (const actor of snapshot.actors) {
    if (actor.lifecycle !== 'alive') continue;
    if (actor.capabilities.blocksMovement) movementKinds[actor.position.y][actor.position.x] = 1;
    if (actor.capabilities.blocksSight) sightKinds[actor.position.y][actor.position.x] = 1;
  }
  const projection = projectActorFields(registry);
  return { tick, actors: snapshot.actors.map(actor => ({ ...actor })),
    tiles: { kinds: movementKinds }, sightKinds,
    affinityFields: projection.fields.map(field => ({ ...field })),
    affinityContributions: projection.contributions.map(field => ({ ...field })) };
}

type RegistryObservation = ReturnType<typeof readActorRegistryObservation>;

/**
 * Fog of war reads the affinity field (maintainer, 2026-10-17, #288): the light and
 * dark on a cell are the emitted light and dark fields there, after the field's own
 * opposite-pair cancellation, keyed `x,y` as the strongest surviving source's stacks.
 * There is one cancellation rule for sight, floor shading and every vital effect.
 * A source shines at full strength while its affinity is on and goes dark when it
 * drains (the generic switch-off), and light reaches as far as its field does.
 */
function fieldStacksByCell(fields: readonly { kind: string; expression: string; stacks: number; intensity: number;
  position: { x: number; y: number } }[], kind: 'light' | 'dark'): Record<string, number> {
  const reached: Record<string, number> = {};
  for (const field of fields) {
    if (field.kind !== kind || field.expression !== AFFINITY_EXPRESSION_BY_CODE[SIGHT_LIGHT_EXPRESSION]
      || field.intensity <= 0 || field.stacks <= 0) continue;
    const key = `${field.position.x},${field.position.y}`;
    if (field.stacks > (reached[key] ?? 0)) reached[key] = field.stacks;
  }
  return reached;
}

/** Net emitted light on each cell of a registry snapshot, from the field (#288). Read-only. */
export function readActorRegistryLightByCell(snapshot: ActorRegistrySnapshot): Record<string, number> {
  return fieldStacksByCell(projectActorFields({ snapshot: () => snapshot }).fields, 'light');
}

/** Net emitted dark on each cell of a registry snapshot, from the field (#288). Read-only. */
export function readActorRegistryDarkByCell(snapshot: ActorRegistrySnapshot): Record<string, number> {
  return fieldStacksByCell(projectActorFields({ snapshot: () => snapshot }).fields, 'dark');
}

/** The stacks of light an actor emits right now: its strongest lit light emit slot, 0 if none. */
function litEmitStacks(actor: ActorRecord, kind: 'light' | 'dark'): number {
  if (actor.lifecycle !== 'alive') return 0;
  return Math.max(0, ...litActorAffinities(actor).filter(pair => pair.kind === kind
    && pair.expression === AFFINITY_EXPRESSION_BY_CODE[SIGHT_LIGHT_EXPRESSION]).map(pair => pair.stacks));
}

/** Per-cell light against dark as the field leaves them. */
function resolveRegistryLightDark(observation: RegistryObservation) {
  const { width, height } = observation.sightKinds.length
    ? { width: observation.sightKinds[0].length, height: observation.sightKinds.length } : { width: 0, height: 0 };
  const darkByCell = fieldStacksByCell(observation.affinityFields, 'dark');
  return { width, height, darkByCell, ...resolveNetLightDark(fieldStacksByCell(observation.affinityFields, 'light'), darkByCell) };
}

/**
 * One observer's sight inputs. Its own light, as far as it survives at its tile,
 * extends its radius; cells where light survives are lit; cells where dark
 * survives are obscured, along with anyone standing in them. Dark from other
 * sources that still survives at its tile by the blinding threshold, once its own
 * dark is left out, leaves it its own tile only (#284).
 */
function resolveRegistrySight(observation: RegistryObservation, self: ActorRecord) {
  const { lightByCell, darkStacksByCell } = resolveRegistryLightDark(observation);
  const tile = `${self.position.x},${self.position.y}`;
  const ownLight = resolveOwnSightLight(litEmitStacks(self, 'light'), lightByCell[tile] ?? 0);
  // Blinding dark (#284): the field at the tile re-resolved without the observer's own dark.
  const atTile = observation.affinityContributions.filter(cell => cell.position.x === self.position.x
    && cell.position.y === self.position.y && !(cell.sourceId === self.id && cell.kind === 'dark'));
  const othersDark = fieldStacksByCell(resolveActorFieldOverlap(atTile), 'dark')[tile] ?? 0;
  return {
    radius: resolveVisibilityRadius({ lightStacks: ownLight, blindingDarkStacks: othersDark }),
    options: { darkStacksByCell, lightByCell, darkObscureThreshold: NET_DARK_OBSCURE_STACK_THRESHOLD },
  };
}
/** Reuse the established radius/occlusion policy with independent sight capabilities. */
export function scopeActorRegistryObservation(observation: RegistryObservation, actorId: string) {
  const self = observation.actors.find(actor => actor.id === actorId);
  if (!self) return { ...observation, actors: [], affinityFields: [], affinityContributions: [] };
  const { radius, options } = resolveRegistrySight(observation, self);
  const scoped = scopeObservation({ ...observation, tiles: { kinds: observation.sightKinds } }, actorId, radius, options);
  const contributions = scopeObservation({ ...observation, affinityFields: observation.affinityContributions,
    tiles: { kinds: observation.sightKinds } }, actorId, radius, options);
  return { ...scoped, tiles: observation.tiles, affinityContributions: contributions.affinityFields };
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
 * Where dark outweighs light right now: a grid the map's shape, 1 dark / 0 not.
 * A remembered map is invalidated wherever this is 1 (#203); the caller keeps
 * the memory, core only says where the dark is.
 */
export function readActorRegistryDarkCells(observation: RegistryObservation): number[][] {
  const { width, height, darkStacksByCell } = resolveRegistryLightDark(observation);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    (darkStacksByCell[`${x},${y}`] ?? 0) >= NET_DARK_OBSCURE_STACK_THRESHOLD ? 1 : 0));
}

/** One affinity's net presence on a cell: what survives opposite-kind cancellation there. */
export interface FieldCellReading { kind: string; stacks: number; intensity: number }

/**
 * Every affinity field on each cell right now, for every kind alike (#287): a
 * grid the map's shape, each cell the emitted (emit/push) fields that survive
 * there after opposite pairs cancel, strongest first. Read from the field
 * projection the tick uses (`affinityFields`), never recomputed.
 */
export function readActorRegistryFieldCells(observation: RegistryObservation): FieldCellReading[][][] {
  const height = observation.sightKinds.length;
  const width = height ? observation.sightKinds[0].length : 0;
  const grid: FieldCellReading[][][] = Array.from({ length: height }, () => Array.from({ length: width }, () => []));
  for (const field of observation.affinityFields) {
    const { x, y } = field.position;
    if (field.expression === 'draw' || field.intensity <= 0 || !grid[y]?.[x]) continue;
    const cell = grid[y][x];
    const existing = cell.find(entry => entry.kind === field.kind);
    if (!existing) cell.push({ kind: field.kind, stacks: field.stacks, intensity: field.intensity });
    else if (field.intensity > existing.intensity) Object.assign(existing, { stacks: field.stacks, intensity: field.intensity });
  }
  for (const row of grid) for (const cell of row) cell.sort((a, b) => b.intensity - a.intensity || (a.kind < b.kind ? -1 : 1));
  return grid;
}
