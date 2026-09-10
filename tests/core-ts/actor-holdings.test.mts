import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord, ActorHolding } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x = 0): ActorRecord {
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 3, max: 10, regen: 1 }, mana: { current: 8, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true,
      canExit: false, blocksMovement: false, blocksSight: false },
    motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}
function setup(holdings: ActorHolding[] = []) {
  const source = actor('source'); source.affinities = [{ kind: 'fire', expression: 'emit', stacks: 8 },
    { kind: 'fire', expression: 'draw', stacks: 2 }]; source.holdings = holdings;
  return createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'],
    actors: [source, actor('looter', 1), actor('other', 1), actor('far', 2)] });
}
const reward = 'affinity:fire:emit';
test('defeat creates one reward per pair; atomic claims survive competition and replay', () => {
  const state = setup();
  expect(state.getActor('source')!.holdings).toEqual([]);
  expect(state.takeHolding('looter', 'source', reward)).toBe(false);
  state.changeVital('source', 'health', -3);
  expect(state.getActor('source')!.holdings.map(h => h.id)).toEqual(['affinity:fire:draw', reward]);
  expect(state.takeHolding('looter', 'source', reward)).toBe(true);
  expect(state.takeHolding('looter', 'source', reward)).toBe(false);
  expect(state.takeHolding('other', 'source', reward)).toBe(false);
  expect(state.getActor('looter')!.affinities).toEqual([{ kind: 'fire', expression: 'emit', stacks: 1 }]);
  expect(state.getActor('looter')!.activeAffinityKey).toBeNull();
  expect(state.takeHolding('other', 'source', 'affinity:fire:draw')).toBe(true);
  const restored = createActorRegistry(JSON.parse(JSON.stringify(state.snapshot())));
  expect(restored.takeHolding('other', 'source', reward)).toBe(false);
  expect(restored.snapshot()).toEqual(state.snapshot());
  expect(state.getActor('source')!.vitals.mana!.current).toBe(8);
});
test('existing receiver pair gains exactly one stack', () => {
  const snapshot = setup().snapshot(); const receiver = snapshot.actors.find(a => a.id === 'looter')!;
  receiver.affinities = [{ kind: 'fire', expression: 'emit', stacks: 4 }];
  const state = createActorRegistry(snapshot); state.changeVital('source', 'health', -3);
  expect(state.takeHolding('looter', 'source', reward)).toBe(true);
  expect(state.getActor('looter')!.affinities[0].stacks).toBe(5);
});
test('range, identity, lifecycle and taking capability are checked before mutation', () => {
  const snapshot = setup().snapshot(); snapshot.actors.find(a => a.id === 'other')!.capabilities.canTake = false;
  const state = createActorRegistry(snapshot); state.changeVital('source', 'health', -3);
  const before = state.snapshot();
  for (const [receiver, source, key] of [['far', 'source', reward], ['other', 'source', reward],
    ['source', 'source', reward], ['missing', 'source', reward], ['looter', 'missing', reward], ['looter', 'source', 'missing']]) {
    expect(state.takeHolding(receiver, source, key)).toBe(false);
  }
  expect(state.snapshot()).toEqual(before);
});
test.each(['consumable', 'level', 'permanent'] as const)('explicit %s grants preserve current/max/regen semantics', mode => {
  const state = setup([{ id: 'grant', kind: 'vital', claimedBy: null, permanenceMode: mode,
    vitals: [{ key: 'mana', delta: 5, regen: 2 }] }]);
  state.changeVital('source', 'health', -3);
  expect(state.takeHolding('looter', 'source', 'grant')).toBe(true);
  expect(state.getActor('looter')!.vitals.mana).toEqual({ current: mode === 'consumable' ? 10 : 13,
    max: mode === 'consumable' ? 10 : 15, regen: 2 });
});
test('invalid holdings and overflowing claims cannot partially grant or claim', () => {
  expect(() => setup([{ id: reward, kind: 'vital', claimedBy: null, permanenceMode: 'level', vitals: [] }])).toThrow();
  const snapshot = setup().snapshot(); snapshot.actors.find(a => a.id === 'looter')!.affinities = [
    { kind: 'fire', expression: 'emit', stacks: Number.MAX_SAFE_INTEGER }];
  const state = createActorRegistry(snapshot); state.changeVital('source', 'health', -3);
  const before = state.snapshot();
  expect(state.takeHolding('looter', 'source', reward)).toBe(false);
  expect(state.snapshot()).toEqual(before);
});
// ## TODO: Test Permutations
// - Tick executor must prohibit movement auto-pickup and a second action after take.
