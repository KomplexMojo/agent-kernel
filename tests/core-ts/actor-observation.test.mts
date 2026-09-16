import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';
import { readActorRegistryObservation, scopeActorRegistryObservation } from '../../packages/core-ts/src/rules/actor-observation.ts';
import { projectActorEquipmentFields } from '../../packages/core-ts/src/rules/actor-fields.ts';

function actor(id: string, x: number): ActorRecord {
  return { id, position: { x, y: 0 }, alignment: 'dungeon', lifecycle: 'alive', defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}

test('movement and sight capabilities stay independent in observations', () => {
  for (const blocksSight of [true, false]) {
    const barrier = actor('barrier', 1);
    barrier.capabilities.blocksSight = blocksSight;
    barrier.capabilities.blocksMovement = !blocksSight;
    const registry = createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain: Array(4).fill('floor'),
      actors: [actor('self', 0), barrier, actor('target', 2)] });
    const observed = scopeActorRegistryObservation(readActorRegistryObservation(registry, 4), 'self');
    expect(observed.actors.some(entry => entry.id === 'target')).toBe(!blocksSight);
    expect(observed.tiles.kinds[0][1]).toBe(blocksSight ? 0 : 1);
  }
});

test('observing projects active light without mutating state; defeated blockers stop occluding', () => {
  const source = actor('self', 0);
  source.affinities = [{ kind: 'light', expression: 'emit', stacks: 2 }];
  source.activeAffinityKey = 'light:emit';
  const barrier = actor('barrier', 1);
  barrier.capabilities.blocksSight = true;
  const registry = createActorRegistry({ dimensions: { width: 6, height: 1 }, terrain: Array(6).fill('floor'),
    actors: [source, barrier, actor('far', 4)] });
  registry.changeVital('barrier', 'health', -10);
  const before = registry.snapshot();
  const observation = readActorRegistryObservation(registry, 1);
  expect(scopeActorRegistryObservation(observation, 'self').actors.map(entry => entry.id)).toContain('far');
  observation.actors[0].vitals.health!.current = 99;
  expect(registry.snapshot()).toEqual(before);
});

test('defeated actors never block movement or sight and never project fields', () => {
  const blocker = actor('blocker', 1);
  blocker.capabilities.blocksMovement = true;
  blocker.capabilities.blocksSight = true;
  blocker.affinities = [{ kind: 'fire', expression: 'emit', stacks: 5 }];
  blocker.activeAffinityKey = 'fire:emit';
  blocker.vitals.health!.current = 0;
  blocker.lifecycle = 'defeated';
  const registry = createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: Array(3).fill('floor'),
    actors: [actor('self', 0), blocker, actor('far', 2)] });
  expect(registry.isMovementBlocked({ x: 1, y: 0 })).toBe(false);
  expect(registry.isSightBlocked({ x: 1, y: 0 })).toBe(false);
  const observation = readActorRegistryObservation(registry, 0);
  expect(observation.affinityFields).toEqual([]);
  expect(scopeActorRegistryObservation(observation, 'self').actors.some(entry => entry.id === 'far')).toBe(true);
});

// ## TODO: Test Permutations
test('visible contributions retain unseen emitters and reappear after switching away from cancellation', () => {
  const self = actor('self', 0);
  self.affinities = [{ kind: 'water', expression: 'emit', stacks: 8 }, { kind: 'fire', expression: 'draw', stacks: 2 }];
  self.activeAffinityKey = 'water:emit';
  const source = actor('unseen', 5);
  source.affinities = [{ kind: 'fire', expression: 'emit', stacks: 8 }];
  source.activeAffinityKey = 'fire:emit';
  const registry = createActorRegistry({ dimensions: { width: 12, height: 1 }, terrain: Array(12).fill('floor'), actors: [self, source] });
  const observation = scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), self.id);
  expect(observation.actors.some(entry => entry.id === source.id)).toBe(false);
  expect(observation.affinityContributions.some(field => field.sourceId === source.id && field.position.x === 0)).toBe(true);
  expect(observation.affinityContributions.some(field => field.position.x === 11)).toBe(false);
  const alternate = { ...self, activeAffinityKey: 'fire:draw' as const };
  expect(projectActorEquipmentFields(alternate, self.position, observation.affinityContributions)
    .some(field => field.sourceId === source.id && field.kind === 'fire')).toBe(true);
});
// - Surviving dark obscures a distant target after light/dark cancellation.
