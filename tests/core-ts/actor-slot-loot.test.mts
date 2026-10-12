import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { ValidationError } from '../../packages/core-ts/src/validate/inputs.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

// Slot-unlock loot (maintainer, 2026-10-12): the most valuable loot. Taking it
// opens more affinity slots, up to the hard cap of 6. It lies on the floor as a
// resource; the Configurator never puts it on a delver or warden.

function delver(overrides: Partial<ActorRecord> = {}): ActorRecord {
  return { id: 'a', alignment: 'external', lifecycle: 'alive', position: { x: 0, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: true, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null,
    holdings: [], ...overrides } as ActorRecord;
}
function cache(slots = 1, claimedBy: string | null = null): ActorRecord {
  return { id: 'cache', alignment: 'dungeon', lifecycle: 'defeated', position: { x: 1, y: 0 }, defeatVital: 'durability',
    vitals: { durability: { current: 0, max: 1, regen: 0 } },
    capabilities: { canMove: false, canCast: true, canEquip: false, canTake: false, canExit: false,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null,
    holdings: [{ id: 'slot_cache', kind: 'slot', slots, claimedBy }] } as ActorRecord;
}
const registry = (actors: ActorRecord[]) =>
  createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'], actors });
function take(reg: ReturnType<typeof registry>) {
  const turn = createActorTurn(reg, 1, { castMana: {}, movementStamina: {} });
  const accepted = turn.apply({ actorId: 'a', tick: 1, kind: 'take', params: { targetId: 'cache', holdingId: 'slot_cache' } });
  return { accepted, reason: turn.lastRejection() };
}

test('taking slot loot opens one more slot and claims the loot', () => {
  const reg = registry([delver({ affinitySlots: 3 }), cache()]);
  expect(take(reg).accepted).toBe(true);
  expect(reg.getActor('a')!.affinitySlots).toBe(4);
  expect(reg.getActor('cache')!.holdings[0].claimedBy).toBe('a');
});

test('a one-slot actor (no slot field) goes to two', () => {
  const reg = registry([delver(), cache()]);
  take(reg);
  expect(reg.getActor('a')!.affinitySlots).toBe(2);
});

test('slots never pass six: loot that would overshoot fills to six, and at six it is refused', () => {
  const near = registry([delver({ affinitySlots: 5 }), cache(3)]);
  expect(take(near).accepted).toBe(true);
  expect(near.getActor('a')!.affinitySlots).toBe(6);
  const full = registry([delver({ affinitySlots: 6 }), cache()]);
  expect(take(full)).toEqual({ accepted: false, reason: 'AffinitySlotsFull' });
  expect(full.getActor('cache')!.holdings[0].claimedBy).toBeNull();
  expect(Object.hasOwn(ValidationError, 'AffinitySlotsFull')).toBe(true);
});

test('a slot holding is validated: a positive whole slot count and no other fields', () => {
  for (const holding of [{ id: 's', kind: 'slot', slots: 0, claimedBy: null },
    { id: 's', kind: 'slot', slots: 1.5, claimedBy: null }, { id: 's', kind: 'slot', claimedBy: null },
    { id: 's', kind: 'slot', slots: 1, claimedBy: null, extra: true }]) {
    expect(() => registry([{ ...cache(), holdings: [holding] } as unknown as ActorRecord])).toThrow();
  }
});

// ## TODO: Test Permutations
// - an already claimed slot holding is NothingToTake
// - a slot holding two tiles away is NotAdjacent
// - an actor without canTake cannot take slot loot (InvalidCapability)
// - a slot holding survives a snapshot round trip
