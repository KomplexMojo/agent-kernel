/**
 * #406 — an intact resource gives up its holdings: a receiver next to an actor that cannot
 * move takes its authored holdings without breaking it (Darren: "Take intact"). Breaking it
 * first still works. A mobile actor's holdings stay sealed until it is defeated.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

function looter(x = 1): ActorRecord {
  return { id: 'looter', alignment: 'external', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 3, max: 10, regen: 1 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true,
      canExit: true, blocksMovement: true, blocksSight: false },
    motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}
function resource({ canMove = false } = {}): ActorRecord {
  return { id: 'chest', alignment: 'dungeon', lifecycle: 'alive', position: { x: 0, y: 0 },
    defeatVital: 'durability', vitals: { durability: { current: 1, max: 1, regen: 0 } },
    capabilities: { canMove, canCast: false, canEquip: false, canTake: false,
      canExit: false, blocksMovement: false, blocksSight: false },
    motivations: [], affinities: [{ kind: 'growth', expression: 'emit', stacks: 1 }], activeAffinityKey: null,
    holdings: [
      { id: 'heal', kind: 'vital', permanenceMode: 'consumable', claimedBy: null, vitals: [{ key: 'health', delta: 5 }] },
    ] };
}
const registry = (source: ActorRecord, receiver = looter()) => createActorRegistry({
  dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'], actors: [source, receiver] });

test('an intact resource next to the receiver gives up its holdings and stays intact', () => {
  const state = registry(resource());
  expect(state.takeHolding('looter', 'chest', 'heal')).toBe(true);
  expect(state.getActor('looter')!.vitals.health!.current).toBe(8);
  expect(state.getActor('chest')!.lifecycle).toBe('alive');
  expect(state.getActor('chest')!.vitals.durability!.current).toBe(1);
  expect(state.takeHolding('looter', 'chest', 'heal')).toBe(false);
  // A claimed holding on an intact actor is valid state: it restores and replays.
  const restored = createActorRegistry(JSON.parse(JSON.stringify(state.snapshot())));
  expect(restored.snapshot()).toEqual(state.snapshot());
  expect(restored.takeHolding('looter', 'chest', 'heal')).toBe(false);
});

test('breaking a resource first still works, and its affinity rewards appear only then', () => {
  const state = registry(resource());
  expect(state.takeHolding('looter', 'chest', 'affinity:growth:emit')).toBe(false);
  state.changeVital('chest', 'durability', -1);
  expect(state.getActor('chest')!.lifecycle).toBe('defeated');
  expect(state.takeHolding('looter', 'chest', 'heal')).toBe(true);
  expect(state.takeHolding('looter', 'chest', 'affinity:growth:emit')).toBe(true);
});

test('an actor that can move keeps its holdings until it is defeated; reach is still checked', () => {
  const mobile = registry(resource({ canMove: true }));
  expect(mobile.takeHolding('looter', 'chest', 'heal')).toBe(false);
  const far = registry(resource(), looter(2));
  expect(far.takeHolding('looter', 'chest', 'heal')).toBe(false);
});

// ## TODO: Test Permutations
// - a 'level' or 'permanent' holding taken intact raises max as it does from a broken resource
// - a receiver without canTake cannot take from an intact resource
