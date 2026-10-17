import type { createActorRegistry } from '../state/actor-registry.ts';
import { projectActorFields } from './actor-fields.ts';
import { computeVisibleCells, NET_DARK_OBSCURE_STACK_THRESHOLD, resolveNetLightDark, resolvePoweredLightStacks,
  resolveVisibilityRadius, scopeObservation, SIGHT_LIGHT_EXPRESSION } from '../state/visibility.ts';
import { computeAffinityRadius } from '../state/affinity-spatial.ts';
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
 * Fog of war: emitted light reaching each cell, keyed `x,y`, as the strongest
 * source's powered stacks. A living light-on-emit actor whose affinity is on
 * shines with its mana-powered stacks (`resolvePoweredLightStacks`), so a
 * drained source is dark and regen relights it. Reach is the emit radius of
 * those stacks, Manhattan like the field projection but without the emit dead
 * zone (a lamp should not leave a dark ring around itself). Dark is weighed per
 * cell by the visibility rule, not here.
 */
export function readActorRegistryLightByCell(snapshot: Pick<ActorRegistrySnapshot, 'dimensions' | 'actors'>): Record<string, number> {
  return readEmittedStacksByCell(snapshot, 'light');
}

/**
 * The dark half of the same reading: emitted dark reaching each cell as the
 * strongest source's powered stacks, with the same reach and the same mana
 * powering as light, so the two compare stack for stack (#203).
 */
export function readActorRegistryDarkByCell(snapshot: Pick<ActorRegistrySnapshot, 'dimensions' | 'actors'>): Record<string, number> {
  return readEmittedStacksByCell(snapshot, 'dark');
}

function readEmittedStacksByCell(snapshot: Pick<ActorRegistrySnapshot, 'dimensions' | 'actors'>, kind: 'light' | 'dark',
  excludeActorId?: string): Record<string, number> {
  const { width, height } = snapshot.dimensions;
  const reached: Record<string, number> = {};
  for (const actor of snapshot.actors) {
    if (actor.id === excludeActorId) continue;
    const stacks = poweredEmitStacks(actor, kind);
    if (stacks <= 0) continue;
    const radius = computeAffinityRadius(SIGHT_LIGHT_EXPRESSION, stacks);
    const { x: sx, y: sy } = actor.position;
    for (let y = Math.max(sy - radius, 0); y <= Math.min(sy + radius, height - 1); y++) {
      const reach = radius - Math.abs(y - sy);
      for (let x = Math.max(sx - reach, 0); x <= Math.min(sx + reach, width - 1); x++) {
        const key = `${x},${y}`;
        if (stacks > (reached[key] ?? 0)) reached[key] = stacks;
      }
    }
  }
  return reached;
}

/** The stacks an actor emits of `kind` right now: its strongest lit emit slot of that kind, 0 if none. */
function poweredEmitStacks(actor: ActorRecord, kind: 'light' | 'dark'): number {
  if (actor.lifecycle !== 'alive') return 0;
  const own = litActorAffinities(actor).filter(pair => pair.kind === kind
    && pair.expression === AFFINITY_EXPRESSION_BY_CODE[SIGHT_LIGHT_EXPRESSION]);
  if (!own.length) return 0;
  const stacks = Math.max(...own.map(pair => pair.stacks));
  return resolvePoweredLightStacks(stacks, actor.vitals.mana?.current ?? 0, actor.vitals.mana?.max ?? 0);
}

/** Per-cell light against dark, stack for stack: what survives at each cell. */
function resolveRegistryLightDark(observation: RegistryObservation) {
  const { width, height } = observation.sightKinds.length
    ? { width: observation.sightKinds[0].length, height: observation.sightKinds.length } : { width: 0, height: 0 };
  const snapshot = { dimensions: { width, height }, actors: observation.actors };
  const darkByCell = readActorRegistryDarkByCell(snapshot);
  return { width, height, darkByCell, ...resolveNetLightDark(readActorRegistryLightByCell(snapshot), darkByCell) };
}

/**
 * One observer's sight inputs. Its own light, less the dark at its tile, extends
 * its radius; cells where light outweighs dark are lit; cells where dark
 * outweighs light are obscured, along with anyone standing in them. Dark from
 * other sources that beats the light at its tile by the blinding threshold
 * leaves it its own tile only (#284).
 */
function resolveRegistrySight(observation: RegistryObservation, self: ActorRecord) {
  const { width, height, lightByCell, darkStacksByCell, darkByCell } = resolveRegistryLightDark(observation);
  const tile = `${self.position.x},${self.position.y}`;
  const ownLight = Math.max(0, poweredEmitStacks(self, 'light') - (darkByCell[tile] ?? 0));
  // Blinding dark (#284) is other sources' dark against all the light at the tile.
  const othersDark = readEmittedStacksByCell({ dimensions: { width, height }, actors: observation.actors }, 'dark', self.id)[tile] ?? 0;
  const lightAtTile = readActorRegistryLightByCell({ dimensions: { width, height }, actors: observation.actors })[tile] ?? 0;
  return {
    radius: resolveVisibilityRadius({ lightStacks: ownLight, blindingDarkStacks: Math.max(0, othersDark - lightAtTile) }),
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
