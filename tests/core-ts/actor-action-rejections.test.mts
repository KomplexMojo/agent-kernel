/**
 * #202: a refused equip, cast or take names its reason, so a player is told why
 * (a ValidationError name, as a refused move already does). Core stays the only
 * judge; the reason is read off the same checks that refuse the action.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { ValidationError } from '../../packages/core-ts/src/validate/inputs.ts';
import type { ActorRecord, ActorAction } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x = 0, overrides: Partial<ActorRecord> = {}): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 },
      stamina: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [
      { kind: 'fire', expression: 'push', stacks: 1 }, { kind: 'light', expression: 'emit', stacks: 1 }],
    activeAffinityKey: 'fire:push', holdings: [], ...overrides } as ActorRecord;
}
const costs = { castManaBase: { 'fire:push': 3 }, movementStamina: { a: 1, b: 1 } };

function refusal(records: ActorRecord[], action: object): string | null {
  const state = createActorRegistry({ dimensions: { width: 6, height: 1 }, terrain: Array(6).fill('floor'), actors: records });
  const turn = createActorTurn(state, 1, costs);
  expect(turn.apply({ ...action, tick: 1 } as ActorAction)).toBe(false);
  return turn.lastRejection();
}
const cast = (targetId: string) => ({ actorId: 'a', kind: 'cast_affinity', params: { targetId } }) as const;
const equip = (affinityKey: string) => ({ actorId: 'a', kind: 'equip_affinity', params: { affinityKey } }) as const;

test('a cast with nothing equipped is NoActiveAffinity', () => {
  expect(refusal([actor('a', 0, { activeAffinityKey: null }), actor('b', 1)], cast('b'))).toBe('NoActiveAffinity');
});
test('casting a lasting affinity is AffinityNotCastable: emit and draw work while equipped', () => {
  expect(refusal([actor('a', 0, { activeAffinityKey: 'light:emit' }), actor('b', 1)], cast('b'))).toBe('AffinityNotCastable');
});
test('a target beyond the stacks range is TargetOutOfRange', () => {
  expect(refusal([actor('a'), actor('b', 3)], cast('b'))).toBe('TargetOutOfRange');
});
test('a cast the actor cannot pay for is InsufficientMana', () => {
  const a = actor('a'); a.vitals.mana!.current = 2;
  expect(refusal([a, actor('b', 1)], cast('b'))).toBe('InsufficientMana');
});
test('a missing or defeated target is InvalidTarget', () => {
  expect(refusal([actor('a'), actor('b', 1)], cast('nobody'))).toBe('InvalidTarget');
});
test('equipping a key the actor does not know is UnknownAffinity', () => {
  expect(refusal([actor('a'), actor('b', 1)], equip('water:push'))).toBe('UnknownAffinity');
});
test('equipping what is already equipped is AffinityAlreadyEquipped', () => {
  expect(refusal([actor('a'), actor('b', 1)], equip('fire:push'))).toBe('AffinityAlreadyEquipped');
});
test('a take with nothing there to claim is NothingToTake; out of reach is NotAdjacent', () => {
  const take = (holdingId: string) => ({ actorId: 'a', kind: 'take', params: { targetId: 'b', holdingId } }) as const;
  const fallen = (x: number) => actor('b', x, { lifecycle: 'defeated', activeAffinityKey: null,
    vitals: { health: { current: 0, max: 10, regen: 0 } } } as Partial<ActorRecord>);
  expect(refusal([actor('a'), fallen(1)], take('affinity:water:push'))).toBe('NothingToTake');
  expect(refusal([actor('a'), fallen(3)], take('affinity:fire:push'))).toBe('NotAdjacent');
});
test('every reason core gives is a ValidationError name', () => {
  for (const name of ['NoActiveAffinity', 'AffinityNotCastable', 'TargetOutOfRange', 'InsufficientMana',
    'InvalidTarget', 'UnknownAffinity', 'AffinityAlreadyEquipped', 'NothingToTake']) {
    expect(Object.hasOwn(ValidationError, name)).toBe(true);
  }
});

// ## TODO: Test Permutations
// - a cast by an actor without canCast is InvalidCapability
// - an equip by an actor without canEquip is InvalidCapability
// - a take by an actor without canTake is InvalidCapability
// - a take of an already claimed holding is NothingToTake
// - a take from a living actor is InvalidTarget
// - self-drain (life pull on self) is InvalidTarget
// - an accepted action leaves lastRejection null
