import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { actorCastableAffinities, actorCastManaPrice } from '../../packages/core-ts/src/rules/actor-cast.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

// #232 (maintainer, 2026-10-13): a push or pull costs the kind's base × s(s+1)/2, with no cap.
function caster(id: string, stacks: number, x = 0, mana = 200): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 50, max: 50, regen: 0 }, mana: { current: mana, max: 200, regen: 0 },
      stamina: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [],
    affinities: [{ kind: 'fire', expression: 'push', stacks }], activeAffinityKey: 'fire:push', holdings: [] };
}
const costs = { castManaBase: { 'fire:push': 3 }, movementStamina: { a: 1, b: 1 } };
function castAt(stacks: number, mana = 200) {
  const state = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'],
    actors: [caster('a', stacks, 0, mana), caster('b', 1, 1)] });
  const ok = createActorTurn(state, 1, costs).apply({ actorId: 'a', tick: 1, kind: 'cast_affinity', params: { targetId: 'b' } });
  return { ok, spent: mana - state.getActor('a')!.vitals.mana!.current };
}

test('the curve is the triangular number times the base', () => {
  expect([1, 2, 3, 4, 5, 6, 7].map(s => actorCastManaPrice(3, s))).toEqual([3, 9, 18, 30, 45, 63, 84]);
});

test('intensity squared multiplies the curve: base × intensity² × r(r+1)/2 (#340, 2026-10-29)', () => {
  expect([1, 2, 3, 6].map(i => actorCastManaPrice(3, 4, i))).toEqual([30, 120, 270, 1080]);
  expect(actorCastManaPrice(3, 4)).toBe(actorCastManaPrice(3, 4, 1));
  const strong = caster('a', 4); strong.affinities[0].intensity = 2;
  const state = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'],
    actors: [strong, caster('b', 1, 1)] });
  expect(createActorTurn(state, 1, costs).apply({ actorId: 'a', tick: 1, kind: 'cast_affinity', params: { targetId: 'b' } })).toBe(true);
  expect(200 - state.getActor('a')!.vitals.mana!.current).toBe(120);
});

test('every stack costs more than the last, past five too', () => {
  const spent = [1, 2, 3, 4, 5, 6, 7].map(s => castAt(s).spent);
  expect(spent).toEqual([3, 9, 18, 30, 45, 63, 84]);
});

test('a caster that cannot pay the curve price is refused and spends nothing', () => {
  expect(castAt(6, 62)).toEqual({ ok: false, spent: 0 });
});

test('a turn takes only curve bases: no tier tables, and not both', () => {
  const state = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'],
    actors: [caster('a', 1), caster('b', 1, 1)] });
  expect(() => createActorTurn(state, 1, { ...costs, castMana: { 'fire:push': [1, 2, 3, 4, 5] } } as never)).toThrow();
  expect(() => createActorTurn(state, 1, { movementStamina: { a: 1, b: 1 }, castMana: { 'fire:push': [1, 2, 3, 4, 5] } } as never)).toThrow();
  expect(() => createActorTurn(state, 1, { movementStamina: { a: 1, b: 1 } } as never)).toThrow();
  expect(() => createActorTurn(state, 1, { castManaBase: { 'fire:push': -1 }, movementStamina: { a: 1, b: 1 } })).toThrow();
});

// Darren, 2026-10-30: a slot shows what one cast costs, which must be what core charges.
test('the castable report carries the mana one cast costs, the same core charges', () => {
  const actor = caster('a', 4);
  expect(actorCastableAffinities(actor)).toEqual({ 'fire:push': { range: 4 } });
  expect(actorCastableAffinities(actor, costs)).toEqual({ 'fire:push': { range: 4, mana: 30 } });
  expect(castAt(4).spent).toBe(30);
  expect(actorCastableAffinities({ ...actor, equippedAffinityStacks: { 'fire:push': 2 } }, costs)['fire:push']).toEqual({ range: 2, mana: 9 });
});
