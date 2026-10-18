import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { resolveActorExposures } from '../../packages/core-ts/src/rules/actor-exposure.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';
function actor(id: string, affinity?: ActorAffinityEntry): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x: 0, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 0 },
      durability: { current: 3, max: 3, regen: 0 }, mana: { current: 0, max: 10, regen: 0 } },
    capabilities: { canMove: false, canCast: true, canEquip: true, canTake: false,
      canExit: false, blocksMovement: false, blocksSight: false }, motivations: [],
    affinities: affinity ? [affinity] : [], activeAffinityKey: affinity ? `${affinity.kind}:${affinity.expression}` : null,
    holdings: [] };
}
const emit = { kind: 'fire', expression: 'emit', stacks: 8 } as const;
const draw = { kind: 'fire', expression: 'draw', stacks: 2 } as const;
function registry(actors: ActorRecord[]) {
  return createActorRegistry({ dimensions: { width: 1, height: 1 }, terrain: ['floor'], actors });
}
// #347: the emit's strength is no longer a pool its receivers share in id order. Each draw
// receiver absorbs its own exposure, capped by that strength; this used to give `b` the 2 left over.
test('each draw receiver absorbs its own exposure, not a share of one pool', () => {
  const state = registry([actor('source', emit), actor('a', draw), actor('b', draw)]);
  const result = resolveActorExposures(state, [{ sourceId: 'source', budget: 5,
    targets: [{ targetId: 'b', amount: 5 }, { targetId: 'a', amount: 3 }] }]);
  expect(result.absorptions).toEqual([{ sourceId: 'source', receiverId: 'a', amount: 3, mana: 3 },
    { sourceId: 'source', receiverId: 'b', amount: 5, mana: 5 }]);
  expect(state.getActor('a')!.vitals.health!.current).toBe(10);
  expect(state.getActor('b')!.vitals.durability!.current).toBe(3);
});
test('absorption caps mana without healing or crediting excess', () => {
  const receiver = actor('receiver', draw); receiver.vitals.mana!.current = 9; receiver.vitals.health!.current = 4;
  const state = registry([actor('source', emit), receiver]);
  const result = resolveActorExposures(state, [{ sourceId: 'source', budget: 5, targets: [{ targetId: 'receiver', amount: 5 }] }]);
  expect(result.absorptions[0]).toEqual({ sourceId: 'source', receiverId: 'receiver', amount: 5, mana: 1 });
  expect(state.getActor('receiver')!.vitals.health!.current).toBe(4);
});
test('pull neutralizes pending matching exposure but cannot repair already applied damage', () => {
  for (const first of [true, false]) {
    const state = registry([actor('source', emit), actor('puller', { ...draw, expression: 'pull' }), actor('target')]);
    const source = { sourceId: 'source', budget: 5, targets: [{ targetId: 'target', amount: 5 }] };
    const pull = { sourceId: 'puller', budget: 5, targets: [{ targetId: 'source', amount: 5 }] };
    const result = resolveActorExposures(state, first ? [pull, source] : [source, pull]);
    expect(state.getActor('target')!.vitals.health!.current).toBe(first ? 10 : 8);
    expect(state.getActor('target')!.vitals.durability!.current).toBe(first ? 3 : 0);
    expect(result.suppressions.length).toBe(first ? 1 : 0);
    expect(state.getActor('puller')!.vitals.mana!.current).toBe(0);
  }
});
test('only active pairs apply; defeated sources stop within a pass', () => {
  const source = actor('source', emit); source.affinities.push(draw); source.activeAffinityKey = null;
  const state = registry([source, actor('target')]); const before = state.snapshot();
  resolveActorExposures(state, [{ sourceId: 'source', budget: 5, targets: [{ targetId: 'target', amount: 5 }] }]);
  expect(state.snapshot()).toEqual(before);
  const killer = actor('killer', { kind: 'water', expression: 'push', stacks: 5 });
  const live = registry([killer, actor('source', emit), actor('target')]);
  resolveActorExposures(live, [{ sourceId: 'killer', budget: 10, targets: [{ targetId: 'source', amount: 10 }] },
    { sourceId: 'source', budget: 5, targets: [{ targetId: 'target', amount: 5 }] }]);
  expect(live.getActor('source')!.lifecycle).toBe('defeated');
  expect(live.getActor('target')!.vitals.health!.current).toBe(10);
});
test('prevalidates the complete batch before mutating and uses shared transfer routing', () => {
  const state = registry([actor('source', { kind: 'growth', expression: 'draw', stacks: 5 }), actor('target')]);
  const before = state.snapshot();
  expect(() => resolveActorExposures(state, [{ sourceId: 'source', budget: 5, targets: [{ targetId: 'target', amount: 5 }] },
    { sourceId: 'source', budget: -1, targets: [] }])).toThrow();
  expect(state.snapshot()).toEqual(before);
  const result = resolveActorExposures(state, [{ sourceId: 'source', budget: 5, targets: [{ targetId: 'target', amount: 5 }] }]);
  expect(result.changes).toEqual([{ actorId: 'target', vital: 'health', delta: -5 }]);
});

test('draw cannot harvest a source incapable of producing exposure', () => {
  const source = actor('source', emit); source.capabilities.canCast = false;
  const state = registry([source, actor('receiver', draw)]);
  const before = state.snapshot();
  const result = resolveActorExposures(state, [
    { sourceId: 'receiver', budget: 5, targets: [{ targetId: 'source', amount: 5 }] },
    { sourceId: 'source', budget: 5, targets: [{ targetId: 'receiver', amount: 5 }] },
  ]);
  expect(result.absorptions).toEqual([]);
  expect(state.snapshot()).toEqual(before);
});

// ## TODO: Test Permutations
// - Projection/tick integration must exercise opposition, occlusion and equipment changing before one field pass.
