import type { createActorRegistry } from '../state/actor-registry.ts';
import { projectActorFields } from './actor-fields.ts';
import { computeVisibleCells, resolveOwnSightLight, resolvePoweredLightStacks, resolveVisibilityRadius, scopeObservation,
  SIGHT_LIGHT_EXPRESSION } from '../state/visibility.ts';
import { computeAffinityRadius } from '../state/affinity-spatial.ts';
import type { ActorRecord, ActorRegistrySnapshot } from '../state/actor-types.ts';
import { isActorAffinityLit } from './actor-upkeep.ts';
import { activeActorAffinity } from '../state/actor-inventory.ts';
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
  const { width, height } = snapshot.dimensions;
  const light: Record<string, number> = {};
  for (const actor of snapshot.actors) {
    const stacks = poweredLightStacks(actor);
    if (stacks <= 0) continue;
    const radius = computeAffinityRadius(SIGHT_LIGHT_EXPRESSION, stacks);
    const { x: sx, y: sy } = actor.position;
    for (let y = Math.max(sy - radius, 0); y <= Math.min(sy + radius, height - 1); y++) {
      const reach = radius - Math.abs(y - sy);
      for (let x = Math.max(sx - reach, 0); x <= Math.min(sx + reach, width - 1); x++) {
        const key = `${x},${y}`;
        if (stacks > (light[key] ?? 0)) light[key] = stacks;
      }
    }
  }
  return light;
}

/** The stacks an actor's own light shines with right now; 0 unless it emits light and it is on. */
function poweredLightStacks(actor: ActorRecord): number {
  const own = activeActorAffinity(actor);
  if (!own || own.kind !== 'light' || own.expression !== AFFINITY_EXPRESSION_BY_CODE[SIGHT_LIGHT_EXPRESSION]
    || !isActorAffinityLit(actor)) return 0;
  return resolvePoweredLightStacks(own.stacks, actor.vitals.mana?.current ?? 0, actor.vitals.mana?.max ?? 0);
}

/** One observer's sight inputs: its radius, the surviving dark, and the lit cells. */
function resolveRegistrySight(observation: RegistryObservation, self: ActorRecord) {
  const darkStacksByCell: Record<string, number> = {};
  let lightStacks = 0; let darkStacks = 0;
  for (const field of observation.affinityFields) {
    if (field.expression !== 'emit') continue;
    if (field.kind === 'dark') darkStacksByCell[`${field.position.x},${field.position.y}`] = field.stacks;
    if (field.position.x !== self.position.x || field.position.y !== self.position.y) continue;
    if (field.kind === 'light') lightStacks = field.stacks;
    if (field.kind === 'dark') darkStacks = field.stacks;
  }
  lightStacks = resolveOwnSightLight(poweredLightStacks(self), lightStacks);
  const { width, height } = observation.sightKinds.length
    ? { width: observation.sightKinds[0].length, height: observation.sightKinds.length } : { width: 0, height: 0 };
  return {
    radius: resolveVisibilityRadius({ lightStacks, darkStacks }),
    options: { darkStacksByCell, lightByCell: readActorRegistryLightByCell({ dimensions: { width, height }, actors: observation.actors }) },
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
