/**
 * #831 (Darren, 2026-11-10): a same-kind slot resists by its own strength. It used to be total
 * immunity whatever its intensity, so a 57-token intensity-1 slot cancelled an intensity-4 cast.
 * Now it cancels incoming harm of its kind up to its own magnitude (push 2 × intensity², emit
 * intensity²) and the rest lands; matching the caster's intensity is still full immunity.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import { receiverAffinityAmount } from '../../packages/core-ts/src/rules/actor-receiver.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x: number, slots: ActorAffinityEntry[]): ActorRecord {
  const vital = { current: 100, max: 100, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { ...vital }, mana: { ...vital }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: slots,
    activeAffinityKey: slots[0] ? `${slots[0].kind}:${slots[0].expression}` : null,
    ...(slots.length > 1 ? { affinitySlots: slots.length, equippedAffinityKeys: slots.map(slot => `${slot.kind}:${slot.expression}`) as ActorRecord["equippedAffinityKeys"] } : {}), holdings: [] };
}

function durabilityLost(casterIntensity: number, receiverSlots: ActorAffinityEntry[]): number {
  const pair = { kind: 'corrode', expression: 'push', stacks: 1, intensity: casterIntensity } as const;
  const state = createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: Array(3).fill('floor'),
    actors: [actor('caster', 0, [pair]), actor('target', 1, receiverSlots)] });
  expect(castFocusedActorAffinity(state, 'caster', 'target', { castManaBase: { 'corrode:push': 0 } }).accepted).toBe(true);
  return 100 - state.getActor('target')!.vitals.durability!.current;
}

const push = (intensity: number): ActorAffinityEntry => ({ kind: 'corrode', expression: 'push', stacks: 1, intensity });
const emit = (intensity: number): ActorAffinityEntry => ({ kind: 'corrode', expression: 'emit', stacks: 1, intensity });

test('an intensity-1 push slot shaves 2 off an intensity-4 hit of 32', () => {
  expect(durabilityLost(4, [])).toBe(32);
  expect(durabilityLost(4, [push(1)])).toBe(30);
});

test('a slot as strong as the cast is still full immunity, and a stronger one takes nothing either', () => {
  expect(durabilityLost(2, [push(2)])).toBe(0);
  expect(durabilityLost(2, [push(3)])).toBe(0);
});

test('an emit slot resists by its own, smaller magnitude (intensity²)', () => {
  expect(durabilityLost(2, [emit(1)])).toBe(7);
  expect(durabilityLost(2, [emit(3)])).toBe(0);
});

test('the strongest same-kind slot counts once: slots do not add up', () => {
  expect(durabilityLost(4, [push(1), emit(2)])).toBe(28);
});

test('what gets past a same-kind slot is still doubled by an opposite slot', () => {
  const receiver = actor('target', 1, [push(1), { kind: 'fortify', expression: 'push', stacks: 1, intensity: 1 }]);
  expect(receiverAffinityAmount(receiver, { kind: 'corrode', expression: 'push' }, 32)).toBe(60);
});

// ## TODO: Test Permutations
// - a field's amount (with falloff) meets the same resist as a cast
// - a same-kind draw still absorbs before any resist
// - every kind, push and pull, against a same-kind push at intensity 1..4
