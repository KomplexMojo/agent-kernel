import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord, ActorRegistrySnapshot } from '../../packages/core-ts/src/state/actor-types.ts';

function fixture(): ActorRegistrySnapshot {
  return { dimensions: { width: 1, height: 1 }, terrain: ['floor'], actors: [{
    id: 'a', alignment: 'external', lifecycle: 'alive', position: { x: 0, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 2 },
      durability: { current: 3, max: 8, regen: 1 }, mana: { current: 2, max: 5, regen: 2 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true,
      canExit: true, blocksMovement: true, blocksSight: true },
    motivations: ['explore'], affinities: [], activeAffinityKey: null, holdings: [],
  }] };
}

test('selected vital alone determines immediate terminal defeat', () => {
  const registry = createActorRegistry(fixture());
  expect(registry.changeVital('a', 'durability', -5)).toBe(-3);
  expect(registry.getActor('a')?.lifecycle).toBe('alive');
  registry.changeVital('a', 'durability', 5);
  expect(registry.changeVital('a', 'health', -20)).toBe(-10);
  expect(registry.getActor('a')?.vitals.durability?.current).toBe(5);
  expect(registry.getActor('a')?.lifecycle).toBe('defeated');
  expect(registry.isMovementBlocked({ x: 0, y: 0 })).toBe(false);
  expect(registry.isSightBlocked({ x: 0, y: 0 })).toBe(false);
  const dead = registry.snapshot();
  expect(registry.changeVital('a', 'health', 10)).toBe(0);
  expect(registry.changeVital('a', 'mana', 10)).toBe(0);
  registry.regenerate();
  expect(registry.snapshot()).toEqual(dead);
  expect(createActorRegistry(JSON.parse(JSON.stringify(dead))).snapshot()).toEqual(dead);
});

test('clamps actual changes and regeneration without creating missing vitals', () => {
  const registry = createActorRegistry(fixture());
  expect(registry.changeVital('a', 'mana', 99)).toBe(3);
  expect(registry.changeVital('a', 'stamina', 99)).toBe(0);
  expect(registry.changeVital('missing', 'health', -99)).toBe(0);
  registry.changeVital('a', 'health', -3);
  registry.regenerate();
  expect(registry.getActor('a')?.vitals).toEqual({ health: { current: 9, max: 10, regen: 2 },
    durability: { current: 4, max: 8, regen: 1 }, mana: { current: 5, max: 5, regen: 2 } });
  for (const delta of [NaN, Infinity, -Infinity]) expect(() => registry.changeVital('a', 'health', delta)).toThrow();
  expect(() => registry.changeVital('a', 'invalid' as 'health', 2)).toThrow();
});

test('durability-governed defeat and zero-at-load normalize before occupancy', () => {
  const input = fixture();
  input.actors[0] = { ...input.actors[0], defeatVital: 'durability', vitals: {
    durability: { current: 0, max: 3, regen: 2 } } };
  const registry = createActorRegistry(input);
  expect(registry.getActor('a')?.lifecycle).toBe('defeated');
  expect(registry.isMovementBlocked({ x: 0, y: 0 })).toBe(false);
  expect(input.actors[0].lifecycle).toBe('alive');
  registry.regenerate();
  expect(registry.getActor('a')?.vitals.durability?.current).toBe(0);
});

test.each([
  { health: { current: -1, max: 10, regen: 0 } },
  { health: { current: 11, max: 10, regen: 0 } },
  { health: { current: 1, max: -1, regen: 0 } },
  { health: { current: 1, max: 10, regen: -1 } },
  { health: { current: 1, max: 10 } },
  { health: null }, {},
  { health: { current: 1, max: 10, regen: 0, reserve: 10 } },
  { health: { current: 1, max: 10, regen: 0 }, unknown: { current: 1, max: 1, regen: 0 } },
])('rejects invalid vital records %j', (vitals) => {
  const input = fixture(); input.actors[0].vitals = vitals as ActorRecord['vitals'];
  expect(() => createActorRegistry(input)).toThrow();
});

test('rejects invalid defeat selection and inconsistent lifecycle', () => {
  for (const patch of [{ defeatVital: 'mana' }, { lifecycle: 'zombie' },
    { lifecycle: 'defeated' }, { alignment: 'warden' }, { capabilities: {} }]) {
    const input = fixture(); Object.assign(input.actors[0], patch);
    expect(() => createActorRegistry(input)).toThrow();
  }
  const input = fixture(); input.actors[0].lifecycle = 'exited';
  const registry = createActorRegistry(input); const before = registry.snapshot();
  registry.changeVital('a', 'health', -10); registry.regenerate();
  expect(registry.snapshot()).toEqual(before);
});

// ## TODO: Test Permutations
// - Field and action milestones must prove defeated sources neither cast nor emit.
