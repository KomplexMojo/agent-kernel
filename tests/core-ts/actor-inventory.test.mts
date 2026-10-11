import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord, ActorAffinityKey } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(): ActorRecord {
  return { id: 'a', alignment: 'dungeon', lifecycle: 'alive', position: { x: 0, y: 0 },
    defeatVital: 'durability', vitals: { durability: { current: 3, max: 3, regen: 0 },
      mana: { current: 7, max: 10, regen: 0 } },
    capabilities: { canMove: false, canCast: true, canEquip: true, canTake: false,
      canExit: false, blocksMovement: false, blocksSight: false },
    motivations: ['explore', 'guard'], affinities: [
      { kind: 'fire', expression: 'emit', stacks: 1 }, { kind: 'fire', expression: 'draw', stacks: 2 }],
    activeAffinityKey: 'fire:emit', holdings: [] };
}
function registry(a = actor()) {
  return createActorRegistry({ dimensions: { width: 1, height: 1 }, terrain: ['floor'], actors: [a] });
}
test('selects one owned pair and preserves shared mana, inventory and all motivations', () => {
  const state = registry(); const before = state.getActor('a')!;
  expect(state.equipAffinity('a', 'fire:draw')).toBe(true);
  expect(state.getActor('a')).toEqual({ ...before, activeAffinityKey: 'fire:draw' });
  expect(state.equipAffinity('a', 'fire:draw')).toBe(false);
  expect(state.equipAffinity('a', 'water:emit')).toBe(false);
  expect(state.equipAffinity('missing', 'fire:emit')).toBe(false);
});
test.each(['defeated', 'exited', 'incapable'] as const)('does not equip %s actors', condition => {
  const a = actor();
  if (condition === 'incapable') a.capabilities.canEquip = false;
  else { a.lifecycle = condition; if (condition === 'defeated') a.vitals.durability!.current = 0; }
  const state = registry(a); const before = state.snapshot();
  expect(state.equipAffinity('a', 'fire:draw')).toBe(false);
  expect(state.snapshot()).toEqual(before);
});
test('rejects invalid active keys, duplicates, stack counts and motivations', () => {
  for (const key of ['water:emit', 'fire', 3, undefined]) {
    const a = actor(); a.activeAffinityKey = key as ActorAffinityKey;
    expect(() => registry(a)).toThrow();
  }
  for (const stacks of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const a = actor(); a.affinities[0].stacks = stacks; expect(() => registry(a)).toThrow();
  }
  const a = actor(); a.affinities.push({ ...a.affinities[0] }); expect(() => registry(a)).toThrow();
  const invalid = actor(); (invalid.motivations as unknown[]).push(7); expect(() => registry(invalid)).toThrow();
  const none = actor(); none.activeAffinityKey = null; expect(registry(none).getActor('a')!.activeAffinityKey).toBeNull();
});
// ## TODO: Test Permutations
// - Tick executor must reject a second action after equipping and emit exactly one field pass.
