import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';
function actor(id: string, x: number, pair?: ActorAffinityEntry): ActorRecord {
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 20, regen: 0 },
      durability: { current: 3, max: 3, regen: 0 }, mana: { current: 30, max: 30, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [] };
}
const pair = { kind: 'fire', expression: 'push', stacks: 3, intensity: 2 } as const;
const costs = { castManaBase: { 'fire:push': 1, 'growth:pull': 1, 'fire:pull': 1 } };
function registry(source = actor('source', 0, pair), target = actor('target', 1)) {
  return createActorRegistry({ dimensions: { width: 10, height: 1 }, terrain: Array(10).fill('floor'), actors: [source, target] });
}
test('focused fire pays authored cost once and routes durability overflow', () => {
  const state = registry(); const result = castFocusedActorAffinity(state, 'source', 'target', costs);
  expect(result.accepted).toBe(true);
  // base 1 × intensity² 4 × range 3·4/2 = 24 (#340, 2026-10-29)
  expect(state.getActor('source')!.vitals.mana!.current).toBe(6);
  // 2 × intensity² = 8: durability 3 first, then 5 into health.
  expect(state.getActor('target')!.vitals.durability!.current).toBe(0);
  expect(state.getActor('target')!.vitals.health!.current).toBe(5);
});
test('unaffordable, missing-price and invalid casts leave both actors unchanged', () => {
  const source = actor('source', 0, pair); source.vitals.mana!.current = 2;
  const state = registry(source); const before = state.snapshot();
  expect(castFocusedActorAffinity(state, 'source', 'target', costs).accepted).toBe(false);
  expect(castFocusedActorAffinity(state, 'source', 'target', { castManaBase: {} }).accepted).toBe(false);
  expect(castFocusedActorAffinity(state, 'source', 'missing', costs).accepted).toBe(false);
  expect(state.snapshot()).toEqual(before);
});
test('the price keeps rising past five stacks, with strength', () => {
  const source = actor('source', 0, { ...pair, stacks: 8, intensity: 3 }); source.vitals.mana = { current: 330, max: 330, regen: 0 };
  const state = registry(source);
  expect(castFocusedActorAffinity(state, 'source', 'target', costs).accepted).toBe(true);
  // base 1 × intensity² 9 × range 8·9/2 = 324; 2 × 3² = 18 harm defeats 3 durability + 10 health
  expect(state.getActor('source')!.vitals.mana!.current).toBe(6);
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
test('growth pull transfers actual removal through durability; self-drain costs nothing', () => {
  const source = actor('source', 0, { kind: 'growth', expression: 'pull', stacks: 3 });
  const target = actor('target', 1); target.vitals.health!.current = 2;
  const state = registry(source, target); const before = state.snapshot();
  expect(castFocusedActorAffinity(state, 'source', 'source', costs).accepted).toBe(false);
  expect(state.snapshot()).toEqual(before);
  expect(castFocusedActorAffinity(state, 'source', 'target', costs).accepted).toBe(true);
  expect(state.getActor('source')!.vitals.health!.current).toBe(12);
  expect(state.getActor('target')!.vitals.durability!.current).toBe(3);
});
// #354: a harmful pull steals its primary vital, durability for fire, and spills the rest.
test('harmful pull steals durability into the caster and spills into health', () => {
  const source = actor('source', 0, { kind: 'fire', expression: 'pull', stacks: 3, intensity: 2 });
  source.vitals.durability!.current = 1;
  const state = registry(source, actor('target', 1));
  const result = castFocusedActorAffinity(state, 'source', 'target', costs);
  expect(result.accepted).toBe(true);
  // 2 × 2² = 8: durability gives up 3, the other 5 spill into health.
  expect(state.getActor('target')!.vitals.durability!.current).toBe(0);
  expect(state.getActor('target')!.vitals.health!.current).toBe(5);
  // The caster gains the 3 durability, capped at 3; the spill is not credited to health.
  expect(state.getActor('source')!.vitals.durability!.current).toBe(3);
  expect(state.getActor('source')!.vitals.health!.current).toBe(10);
});
test('malformed authored prices are rejected before any mutation', () => {
  const state = registry(); const before = state.snapshot();
  for (const price of [-1, NaN, 1.5, [1, 2, 3, 4, 5]]) {
    expect(() => castFocusedActorAffinity(state, 'source', 'target', { castManaBase: { 'fire:push': price } } as never)).toThrow();
  }
  // A five-tier table is not a price model core accepts any more (#232).
  expect(() => castFocusedActorAffinity(state, 'source', 'target', { 'fire:push': [1, 2, 3, 4, 5] } as never)).toThrow();
  expect(state.snapshot()).toEqual(before);
});
// ## TODO: Test Permutations
// - Tick executor must prohibit any second action after accepted casting/equipping.
