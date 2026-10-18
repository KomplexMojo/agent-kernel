import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { resolveActorAffinity } from '../../packages/core-ts/src/rules/actor-affinity.ts';
import type { ActorRecord, AffinityKind, AffinityExpression } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x: 0, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 20, regen: 0 },
      durability: { current: 3, max: 10, regen: 0 }, mana: { current: 4, max: 10, regen: 0 },
      stamina: { current: 6, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true,
      canExit: true, blocksMovement: false, blocksSight: false },
    motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}
function registry(records = [actor('source'), actor('target')]) {
  return createActorRegistry({ dimensions: { width: 1, height: 1 }, terrain: ['floor'], actors: records });
}
const positive: [AffinityKind, number[]][] = [
  ['fire', [8, 0, 4, 6]], ['water', [10, 3, 4, 1]], ['earth', [8, 0, 4, 6]],
  ['wind', [10, 3, 4, 1]], ['growth', [15, 3, 4, 6]], ['decay', [5, 3, 4, 6]],
  ['corrode', [8, 0, 4, 6]], ['fortify', [10, 8, 4, 6]],
  ['light', [10, 3, 9, 6]], ['dark', [9, 3, 0, 6]], // #353: water takes stamina; dark spills into health
];
for (const expression of ['push', 'emit'] as const) {
  test.each(positive)(`${expression} routes %s with magnitude 5`, (kind, expected) => {
    const state = registry(); resolveActorAffinity(state, 'source', 'target', kind, expression, 5);
    const pools = state.getActor('target')!.vitals;
    expect(['health', 'durability', 'mana', 'stamina'].map(key => pools[key as keyof typeof pools]?.current)).toEqual(expected);
  });
}
for (const expression of ['pull', 'draw'] as const) {
  test.each(positive)(`${expression} routes %s without blanket sign reversal`, (kind) => {
    const state = registry(); const before = state.snapshot();
    const result = resolveActorAffinity(state, 'source', 'target', kind, expression, 5);
    const key = kind === 'growth' ? 'health' : kind === 'fortify' ? 'durability' : kind === 'light' ? 'mana' : null;
    if (!key) { expect(state.snapshot()).toEqual(before); expect(result.operation).toBe('neutralize'); }
    else {
      const initial = before.actors.find(a => a.id === 'target')!.vitals[key]!.current;
      const removed = Math.min(5, initial);
      expect(state.getActor('target')!.vitals[key]!.current).toBe(initial - removed);
      expect(state.getActor('source')!.vitals[key]!.current).toBe(initial + removed);
    }
  });
}

test('actual growth drain kills through durability and caps receiver credit', () => {
  const source = actor('source'); source.vitals.health!.current = 19;
  const target = actor('target'); target.vitals.health!.current = 2;
  const state = registry([source, target]);
  const result = resolveActorAffinity(state, 'source', 'target', 'growth', 'pull', 5);
  expect(result.changes).toEqual([{ actorId: 'target', vital: 'health', delta: -2 },
    { actorId: 'source', vital: 'health', delta: 1 }]);
  expect(state.getActor('target')!.lifecycle).toBe('defeated');
  expect(state.getActor('target')!.vitals.durability!.current).toBe(3);
  const before = state.snapshot();
  resolveActorAffinity(state, 'source', 'target', 'growth', 'push', 5);
  resolveActorAffinity(state, 'target', 'source', 'growth', 'pull', 5);
  expect(state.snapshot()).toEqual(before);
});

test('missing durability offers no protection and missing target pool has no effect', () => {
  const target = actor('target'); delete target.vitals.durability; delete target.vitals.mana;
  const state = registry([actor('source'), target]);
  resolveActorAffinity(state, 'source', 'target', 'fire', 'push', 5);
  expect(state.getActor('target')!.vitals.health!.current).toBe(5);
  expect(resolveActorAffinity(state, 'source', 'target', 'light', 'pull', 5).changes).toEqual([]);
  // Corrode spills like fire (Darren, 2026-10-15): no armour, so all of it reaches health.
  resolveActorAffinity(state, 'source', 'target', 'corrode', 'push', 5);
  expect(state.getActor('target')!.vitals.health!.current).toBe(0);
  expect(state.getActor('target')!.lifecycle).toBe('defeated');
});

test('rejects self-drain and malformed inputs atomically', () => {
  const state = registry(); const before = state.snapshot();
  expect(() => resolveActorAffinity(state, 'source', 'source', 'growth', 'pull', 5)).toThrow(/self/);
  for (const amount of [-1, NaN, Infinity]) expect(() => resolveActorAffinity(state, 'source', 'target', 'fire', 'push', amount)).toThrow();
  expect(() => resolveActorAffinity(state, 'source', 'target', 'unknown' as AffinityKind, 'push', 5)).toThrow();
  expect(() => resolveActorAffinity(state, 'source', 'target', 'fire', 'attack' as AffinityExpression, 5)).toThrow();
  expect(state.snapshot()).toEqual(before);
});

// ## TODO: Test Permutations
// - Integrate the same resolver with spatially evaluated casts and bounded field exposure.
