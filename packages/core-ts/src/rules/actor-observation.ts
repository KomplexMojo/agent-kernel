import type { createActorRegistry } from '../state/actor-registry.ts';
import { projectActorFields } from './actor-fields.ts';
import { resolveVisibilityRadius, scopeObservation } from '../state/visibility.ts';

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

/** Reuse the established radius/occlusion policy with independent sight capabilities. */
export function scopeActorRegistryObservation(observation: ReturnType<typeof readActorRegistryObservation>, actorId: string) {
  const self = observation.actors.find(actor => actor.id === actorId);
  if (!self) return { ...observation, actors: [], affinityFields: [], affinityContributions: [] };
  const darkStacksByCell: Record<string, number> = {};
  let lightStacks = 0; let darkStacks = 0;
  for (const field of observation.affinityFields) {
    if (field.expression !== 'emit') continue;
    if (field.kind === 'dark') darkStacksByCell[`${field.position.x},${field.position.y}`] = field.stacks;
    if (field.position.x !== self.position.x || field.position.y !== self.position.y) continue;
    if (field.kind === 'light') lightStacks = field.stacks;
    if (field.kind === 'dark') darkStacks = field.stacks;
  }
  const scoped = scopeObservation({ ...observation, tiles: { kinds: observation.sightKinds } }, actorId,
    resolveVisibilityRadius({ lightStacks, darkStacks }), { darkStacksByCell });
  const contributions = scopeObservation({ ...observation, affinityFields: observation.affinityContributions,
    tiles: { kinds: observation.sightKinds } }, actorId,
    resolveVisibilityRadius({ lightStacks, darkStacks }), { darkStacksByCell });
  return { ...scoped, tiles: observation.tiles, affinityContributions: contributions.affinityFields };
}
