import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';
function actor(id: string, x: number, pair?: ActorAffinityEntry): ActorRecord {
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 20, regen: 0 },
      durability: { current: 3, max: 3, regen: 0 }, mana: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [] };
}
const pair = { kind: 'fire', expression: 'push', stacks: 3 } as const;
const costs = { 'fire:push': [1, 2, 3, 4, 5], 'life:pull': [1, 2, 3, 4, 5], 'fire:pull': [1, 2, 3, 4, 5] };
function registry(source = actor('source', 0, pair), target = actor('target', 1)) {
  return createActorRegistry({ dimensions: { width: 10, height: 1 }, terrain: Array(10).fill('floor'), actors: [source, target] });
}
test('focused fire pays authored cost once and routes durability overflow', () => {
  const state = registry(); const result = castFocusedActorAffinity(state, 'source', 'target', costs);
  expect(result.accepted).toBe(true);
  expect(state.getActor('source')!.vitals.mana!.current).toBe(7);
  expect(state.getActor('target')!.vitals.durability!.current).toBe(0);
  expect(state.getActor('target')!.vitals.health!.current).toBe(7);
});
test('unaffordable, missing-price and invalid casts leave both actors unchanged', () => {
  const source = actor('source', 0, pair); source.vitals.mana!.current = 2;
  const state = registry(source); const before = state.snapshot();
  expect(castFocusedActorAffinity(state, 'source', 'target', costs).accepted).toBe(false);
  expect(castFocusedActorAffinity(state, 'source', 'target', {}).accepted).toBe(false);
  expect(castFocusedActorAffinity(state, 'source', 'missing', costs).accepted).toBe(false);
  expect(state.snapshot()).toEqual(before);
});
test('authored tier lookup clamps at five without clamping strength', () => {
  const state = registry(actor('source', 0, { ...pair, stacks: 8 }));
  expect(castFocusedActorAffinity(state, 'source', 'target', costs).accepted).toBe(true);
  expect(state.getActor('source')!.vitals.mana!.current).toBe(5);
  expect(state.getActor('target')!.lifecycle).toBe('defeated');
});
test('range, active expression, capability and lifecycle gate casts', () => {
  for (const mode of ['range', 'emit', 'incapable', 'defeated', 'unequipped']) {
    const source = actor('source', 0, pair); const target = actor('target', mode === 'range' ? 4 : 1);
    if (mode === 'emit') { source.affinities[0].expression = 'emit'; source.activeAffinityKey = 'fire:emit'; }
    if (mode === 'incapable') source.capabilities.canCast = false;
    if (mode === 'defeated') { source.lifecycle = 'defeated'; source.vitals.health!.current = 0; }
    if (mode === 'unequipped') source.activeAffinityKey = null;
    const state = registry(source, target); const before = state.snapshot();
    expect(castFocusedActorAffinity(state, 'source', 'target', costs).accepted).toBe(false);
    expect(state.snapshot()).toEqual(before);
  }
});
test('life pull transfers actual removal through durability; self-drain costs nothing', () => {
  const source = actor('source', 0, { kind: 'life', expression: 'pull', stacks: 3 });
  const target = actor('target', 1); target.vitals.health!.current = 2;
  const state = registry(source, target); const before = state.snapshot();
  expect(castFocusedActorAffinity(state, 'source', 'source', costs).accepted).toBe(false);
  expect(state.snapshot()).toEqual(before);
  expect(castFocusedActorAffinity(state, 'source', 'target', costs).accepted).toBe(true);
  expect(state.getActor('source')!.vitals.health!.current).toBe(12);
  expect(state.getActor('target')!.vitals.durability!.current).toBe(3);
});
test('neutralizing pull reports pending suppression without healing or removing equipment', () => {
  const state = registry(actor('source', 0, { kind: 'fire', expression: 'pull', stacks: 3 }),
    actor('target', 1, { kind: 'fire', expression: 'emit', stacks: 8 }));
  const before = state.getActor('target');
  const result = castFocusedActorAffinity(state, 'source', 'target', costs);
  expect(result.suppression).toEqual({ sourceId: 'source', targetId: 'target', affinityKey: 'fire:emit', amount: 6 });
  expect(state.getActor('target')).toEqual(before);
});
test('malformed authored prices are rejected before any mutation', () => {
  const state = registry(); const before = state.snapshot();
  for (const price of [[1], [1, 2, -1, 4, 5], [1, 2, NaN, 4, 5]]) {
    expect(() => castFocusedActorAffinity(state, 'source', 'target', { 'fire:push': price })).toThrow();
  }
  expect(state.snapshot()).toEqual(before);
});
// ## TODO: Test Permutations
// - Tick executor must persist suppression and prohibit any second action after accepted casting/equipping.
