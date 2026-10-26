import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn, WATCH_MANA_UPKEEP } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

// #519 (Darren, 2026-10-26): watching an actor costs 1 mana a turn per watch; a watch ends when
// mana cannot pay it or the target is gone. Ending one is free.

function actor(id: string, x: number, mana = 3): ActorRecord {
  return { id, position: { x, y: 0 }, alignment: 'dungeon', lifecycle: 'alive', defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: mana, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}
const costs = { castManaBase: {}, movementStamina: {} };
const watch = (actorId: string, targetId: string, tick: number) => ({ actorId, tick, kind: 'watch' as const, params: { targetId } });

function setup(mana = 3) {
  return createActorRegistry({ dimensions: { width: 6, height: 1 }, terrain: Array(6).fill('floor'),
    actors: [actor('a', 0, mana), actor('b', 3), actor('c', 5)] });
}
function turn(registry: ReturnType<typeof setup>, tick: number, actions: ReturnType<typeof watch>[] = []) {
  const t = createActorTurn(registry, tick, costs);
  const results = actions.map(action => t.apply(action));
  t.closeActions(); t.resolveFields(); t.regenerate(); t.resolveExits();
  return results;
}
const mana = (registry: ReturnType<typeof setup>) => registry.getActor('a')!.vitals.mana!.current;

test('a watch costs its upkeep every turn, starting the turn it begins', () => {
  const registry = setup();
  expect(turn(registry, 0, [watch('a', 'b', 0)])).toEqual([true]);
  expect(registry.getActor('a')!.watching).toEqual(['b']);
  expect(mana(registry)).toBe(3 - WATCH_MANA_UPKEEP);
  turn(registry, 1);
  expect(mana(registry)).toBe(3 - 2 * WATCH_MANA_UPKEEP);
});

test('every watch pays its own upkeep', () => {
  const registry = setup();
  turn(registry, 0, [watch('a', 'b', 0)]);
  turn(registry, 1, [watch('a', 'c', 1)]);
  expect(registry.getActor('a')!.watching).toEqual(['b', 'c']);
  expect(mana(registry)).toBe(3 - 1 - 2);
});

test('the same command again stops the watch, which is free', () => {
  const registry = setup();
  turn(registry, 0, [watch('a', 'b', 0)]);
  expect(turn(registry, 1, [watch('a', 'b', 1)])).toEqual([true]);
  expect(registry.getActor('a')!.watching).toBeUndefined();
  expect(mana(registry)).toBe(2);
});

test('a watch needs the first turn\'s mana, a living target other than yourself', () => {
  const dry = setup(0);
  expect(turn(dry, 0, [watch('a', 'b', 0)])).toEqual([false]);
  const registry = setup();
  expect(turn(registry, 0, [watch('a', 'a', 0)])).toEqual([false]);
  expect(turn(registry, 1, [watch('a', 'nobody', 1)])).toEqual([false]);
  expect(registry.getActor('a')!.watching).toBeUndefined();
});

test('a watch ends when mana runs out, and when the target is defeated', () => {
  const registry = setup(1);
  turn(registry, 0, [watch('a', 'b', 0)]);
  expect(mana(registry)).toBe(0);
  turn(registry, 1);
  expect(registry.getActor('a')!.watching).toBeUndefined();

  const other = setup();
  turn(other, 0, [watch('a', 'b', 0)]);
  other.changeVital('b', 'health', -10);
  turn(other, 1);
  expect(other.getActor('a')!.watching).toBeUndefined();
});

test('a watch survives a snapshot round trip', () => {
  const registry = setup();
  turn(registry, 0, [watch('a', 'b', 0)]);
  const restored = createActorRegistry(registry.snapshot());
  expect(restored.getActor('a')!.watching).toEqual(['b']);
});
