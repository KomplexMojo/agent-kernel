import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { projectActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
import { readActorRegistryLightByCell } from '../../packages/core-ts/src/rules/actor-observation.ts';
import { equippedActorAffinityKeys } from '../../packages/core-ts/src/state/actor-inventory.ts';
import { ValidationError } from '../../packages/core-ts/src/validate/inputs.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

// Equipped affinity slots (maintainer, 2026-10-12): an actor equips up to
// `affinitySlots` affinities at once (omitted = 1, today's behaviour). Every lit
// emit/draw slot is its own field and pays its own 2 + range + intensity upkeep (#340); a slot that
// cannot pay goes off on its own. Nothing is refused for being unwise: opposite
// emits on one actor are allowed and cancel through the field overlap rule.

const PAIRS: ActorAffinityEntry[] = [
  { kind: 'fire', expression: 'push', stacks: 1 },
  { kind: 'light', expression: 'emit', stacks: 1 },
  { kind: 'dark', expression: 'emit', stacks: 1 },
  { kind: 'water', expression: 'push', stacks: 2 },
];

function actor(id: string, x: number, overrides: Partial<ActorRecord> = {}): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 20, max: 20, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: structuredClone(PAIRS),
    activeAffinityKey: null, holdings: [], ...overrides } as ActorRecord;
}
const corridor = (actors: ActorRecord[], width = 10) =>
  createActorRegistry({ dimensions: { width, height: 1 }, terrain: Array(width).fill('floor'), actors });
const UPKEEP = Array.from({ length: 11 }, (_, stacks) => (stacks === 0 ? 0 : 2 + stacks));
const costs = { castManaBase: { 'fire:push': 1, 'water:push': 1 }, movementStamina: {},
  persistentUpkeep: UPKEEP };

function act(registry: ReturnType<typeof corridor>, tick: number, action: object): { accepted: boolean; reason: string | null } {
  const turn = createActorTurn(registry, tick, costs);
  const accepted = turn.apply({ actorId: 'a', tick, ...action } as never);
  const reason = turn.lastRejection();
  turn.closeActions(); turn.resolveFields(); turn.regenerate(); turn.resolveExits();
  return { accepted, reason };
}
const equip = (affinityKey: string, replaceKey?: string) =>
  ({ kind: 'equip_affinity', params: replaceKey ? { affinityKey, replaceKey } : { affinityKey } });

test('a three-slot actor equips into free slots in order; the first equipped stays the active key', () => {
  const registry = corridor([actor('a', 0, { affinitySlots: 3 })]);
  expect(act(registry, 1, equip('fire:push')).accepted).toBe(true);
  expect(act(registry, 2, equip('light:emit')).accepted).toBe(true);
  const record = registry.getActor('a')!;
  expect(equippedActorAffinityKeys(record)).toEqual(['fire:push', 'light:emit']);
  expect(record.activeAffinityKey).toBe('fire:push');
});

test('when the slots are full an equip replaces the oldest, or the slot it names', () => {
  const registry = corridor([actor('a', 0, { affinitySlots: 2, activeAffinityKey: 'fire:push',
    equippedAffinityKeys: ['fire:push', 'light:emit'] })]);
  expect(act(registry, 1, equip('dark:emit')).accepted).toBe(true);
  expect(equippedActorAffinityKeys(registry.getActor('a')!)).toEqual(['light:emit', 'dark:emit']);
  expect(act(registry, 2, equip('water:push', 'dark:emit')).accepted).toBe(true);
  expect(equippedActorAffinityKeys(registry.getActor('a')!)).toEqual(['light:emit', 'water:push']);
  expect(act(registry, 3, equip('fire:push', 'dark:emit'))).toEqual({ accepted: false, reason: 'AffinityNotEquipped' });
});

test('a single-slot actor swaps exactly as before and its record gains no new fields', () => {
  const registry = corridor([actor('a', 0, { activeAffinityKey: 'fire:push' })]);
  expect(act(registry, 1, equip('water:push')).accepted).toBe(true);
  const record = registry.getActor('a')!;
  expect(record.activeAffinityKey).toBe('water:push');
  expect(Object.hasOwn(record, 'equippedAffinityKeys')).toBe(false);
});

test('unequip frees the slot and takes the turn; unequipping what is not equipped is refused', () => {
  const registry = corridor([actor('a', 0, { affinitySlots: 2, activeAffinityKey: 'fire:push',
    equippedAffinityKeys: ['fire:push', 'light:emit'] })]);
  expect(act(registry, 1, { kind: 'unequip_affinity', params: { affinityKey: 'fire:push' } }).accepted).toBe(true);
  expect(equippedActorAffinityKeys(registry.getActor('a')!)).toEqual(['light:emit']);
  expect(registry.getActor('a')!.activeAffinityKey).toBe('light:emit');
  expect(act(registry, 2, { kind: 'unequip_affinity', params: { affinityKey: 'fire:push' } }))
    .toEqual({ accepted: false, reason: 'AffinityNotEquipped' });
  expect(Object.hasOwn(ValidationError, 'AffinityNotEquipped')).toBe(true);
});

test('each lit slot pays its own upkeep; the one that cannot pay goes off alone and returns at full mana', () => {
  const a = actor('a', 0, { affinitySlots: 2, activeAffinityKey: 'light:emit', equippedAffinityKeys: ['light:emit', 'dark:emit'] });
  a.vitals.mana = { current: 4, max: 20, regen: 0 };
  const registry = corridor([a]);
  act(registry, 1, { kind: 'wait' });
  const record = registry.getActor('a')!;
  // light pays 2 + 1 + 1 = 4 from 4; dark cannot pay and goes off alone.
  expect(record.vitals.mana!.current).toBe(0);
  expect(record.exhaustedAffinityKeys).toEqual(['dark:emit']);
  expect(record.affinityExhausted).toBe(true);
  const full = registry.getActor('a')!;
  full.vitals.mana!.regen = 20;
  const refilled = corridor([full]);
  act(refilled, 2, { kind: 'wait' });
  expect(refilled.getActor('a')!.exhaustedAffinityKeys).toBeUndefined();
  expect(refilled.getActor('a')!.affinityExhausted).toBeUndefined();
});

test('every lit emit slot is its own field source', () => {
  const registry = corridor([actor('a', 0, { affinitySlots: 2, activeAffinityKey: 'light:emit',
    equippedAffinityKeys: ['light:emit', 'fire:push'] }), actor('b', 5, { affinities: [
    { kind: 'fire', expression: 'emit', stacks: 1 }], activeAffinityKey: 'fire:emit' })]);
  const kinds = new Set(projectActorFields(registry).fields.map(cell => `${cell.sourceId}:${cell.kind}`));
  expect(kinds).toEqual(new Set(['a:light', 'b:fire']));
  const two = corridor([actor('a', 0, { affinitySlots: 2, activeAffinityKey: 'light:emit',
    equippedAffinityKeys: ['light:emit', 'water:push'], affinities: [...structuredClone(PAIRS),
      { kind: 'fire', expression: 'emit', stacks: 1 }] })]);
  expect(projectActorFields(two).sources.map(source => source.affinityKey)).toEqual(['light:emit']);
});

test('light and dark emitted by one actor are allowed, both pay, and they cancel each other', () => {
  const a = actor('a', 3, { affinitySlots: 2, activeAffinityKey: 'light:emit', equippedAffinityKeys: ['light:emit', 'dark:emit'] });
  const registry = corridor([a]);
  expect(projectActorFields(registry).fields.filter(cell => cell.kind === 'light' || cell.kind === 'dark')).toEqual([]);
  act(registry, 1, { kind: 'wait' });
  expect(registry.getActor('a')!.vitals.mana!.current).toBe(20 - 4 - 4);
});

test('light from any lit light:emit slot lights the actor\'s surroundings, not only the first slot', () => {
  const registry = corridor([actor('a', 3, { affinitySlots: 2, activeAffinityKey: 'fire:push',
    equippedAffinityKeys: ['fire:push', 'light:emit'] })]);
  expect(Object.keys(readActorRegistryLightByCell(registry.snapshot())).length).toBeGreaterThan(0);
});

test('a cast names its slot, or uses the first equipped push or pull', () => {
  const registry = corridor([actor('a', 0, { affinitySlots: 3, activeAffinityKey: 'light:emit',
    equippedAffinityKeys: ['light:emit', 'fire:push', 'water:push'] }), actor('b', 1, { affinities: [] })]);
  expect(act(registry, 1, { kind: 'cast_affinity', params: { targetId: 'b' } }).accepted).toBe(true);
  expect(registry.getActor('a')!.vitals.mana!.current).toBe(20 - 1 - 4); // fire:push at range 1, then light upkeep 2 + 1 + 1
  expect(act(registry, 2, { kind: 'cast_affinity', params: { targetId: 'b', affinityKey: 'water:push' } }).accepted).toBe(true);
  expect(registry.getActor('b')!.vitals.health!.current).toBeLessThan(10);
  expect(act(registry, 3, { kind: 'cast_affinity', params: { targetId: 'b', affinityKey: 'dark:emit' } }))
    .toEqual({ accepted: false, reason: 'AffinityNotEquipped' });
});

test('a matching draw slot absorbs before an opposite slot can double the damage', () => {
  const source = actor('src', 0, { alignment: 'dungeon', affinities: [{ kind: 'fire', expression: 'emit', stacks: 2, intensity: 2 }],
    activeAffinityKey: 'fire:emit' });
  const exposed = (equipped: string[], extra: ActorAffinityEntry[]) => {
    // Two tiles out at intensity 2 the rounded exposure (#283) is 1, so a doubling shows under the budget of 4.
    const receiver = actor('a', 2, { affinitySlots: 2, affinities: extra, activeAffinityKey: equipped[0] as never,
      ...(equipped.length > 1 ? { equippedAffinityKeys: equipped as never } : {}) });
    receiver.vitals.mana = { current: 0, max: 20, regen: 0 };
    const registry = corridor([source, receiver]);
    const turn = createActorTurn(registry, 1, { castManaBase: {}, movementStamina: {} });
    turn.closeActions(); turn.resolveFields();
    return registry.getActor('a')!.vitals;
  };
  const lone = exposed(['growth:emit'], [{ kind: 'growth', expression: 'emit', stacks: 1 }]);
  const opposed = exposed(['growth:emit', 'water:push'], [{ kind: 'growth', expression: 'emit', stacks: 1 },
    { kind: 'water', expression: 'push', stacks: 1 }]);
  // Doubled before rounding (raw ~1.5 → 3), still under the source's finite budget (1 × intensity² = 4).
  expect(10 - lone.health!.current).toBe(1);
  expect(10 - opposed.health!.current).toBe(3);
  expect(10 - opposed.health!.current).toBeGreaterThan(10 - lone.health!.current);
  const absorbing = exposed(['water:push', 'fire:draw'], [{ kind: 'water', expression: 'push', stacks: 1 },
    { kind: 'fire', expression: 'draw', stacks: 1 }]);
  expect(absorbing.health!.current).toBe(10);
  expect(absorbing.mana!.current).toBeGreaterThan(0);
});

test('the record is validated: slot count 1..6, equipped keys known, unique, within slots, first is the active key', () => {
  const load = (overrides: Partial<ActorRecord>) => () => corridor([actor('a', 0, overrides)]);
  expect(load({ affinitySlots: 7 })).toThrow();
  expect(load({ affinitySlots: 0 })).toThrow();
  expect(load({ affinitySlots: 1, activeAffinityKey: 'fire:push', equippedAffinityKeys: ['fire:push', 'light:emit'] })).toThrow();
  expect(load({ affinitySlots: 2, activeAffinityKey: 'fire:push', equippedAffinityKeys: ['fire:push', 'growth:emit'] as never })).toThrow();
  expect(load({ affinitySlots: 2, activeAffinityKey: 'fire:push', equippedAffinityKeys: ['fire:push', 'fire:push'] })).toThrow();
  expect(load({ affinitySlots: 2, activeAffinityKey: 'light:emit', equippedAffinityKeys: ['fire:push', 'light:emit'] })).toThrow();
  expect(load({ affinitySlots: 2, activeAffinityKey: 'fire:push', equippedAffinityKeys: ['fire:push'],
    exhaustedAffinityKeys: ['light:emit'], affinityExhausted: true })).toThrow();
  expect(load({ affinitySlots: 6, activeAffinityKey: 'fire:push', equippedAffinityKeys: ['fire:push', 'light:emit'] })).not.toThrow();
});

// ## TODO: Test Permutations
// - an equip with replaceKey on an actor with a free slot replaces that slot anyway
// - unequipping the only equipped affinity leaves activeAffinityKey null and no equippedAffinityKeys
// - unequipping an exhausted slot drops its exhaustion
// - an equip that replaces an exhausted slot drops its exhaustion
// - a legacy record with affinityExhausted and no exhaustedAffinityKeys treats every equipped slot as off
// - a canEquip:false actor cannot equip or unequip (InvalidCapability)
// - two draw slots of different kinds each absorb their own kind
// - a harmful pull against a two-slot target meets the receiver rules of every slot
