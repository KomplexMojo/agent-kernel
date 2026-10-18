import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { equippedActorAffinities } from '../../packages/core-ts/src/state/actor-inventory.ts';
import { ValidationError } from '../../packages/core-ts/src/validate/inputs.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

// #345: an equipped affinity may run below the intensity it holds, the same way #230
// lets it run below its range. Running intensity decides cast price and harm, upkeep and
// field strength; the held intensity (what was bought) stays.

function actor(id: string, x: number, overrides: Partial<ActorRecord> = {}): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 30, max: 30, regen: 0 }, mana: { current: 40, max: 40, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [],
    affinities: [{ kind: 'fire', expression: 'emit', stacks: 3, intensity: 3 },
      { kind: 'water', expression: 'push', stacks: 2, intensity: 3 }],
    activeAffinityKey: null, holdings: [], ...overrides } as ActorRecord;
}
const UPKEEP = Array.from({ length: 11 }, (_, stacks) => (stacks === 0 ? 0 : 2 + stacks));
const costs = { castManaBase: { 'water:push': 1 }, movementStamina: {}, persistentUpkeep: UPKEEP };
const corridor = (actors: ActorRecord[]) =>
  createActorRegistry({ dimensions: { width: 8, height: 1 }, terrain: Array(8).fill('floor'), actors });
function act(registry: ReturnType<typeof corridor>, tick: number, action: object) {
  const turn = createActorTurn(registry, tick, costs);
  const accepted = turn.apply({ actorId: 'a', tick, ...action } as never);
  const reason = turn.lastRejection();
  turn.closeActions(); turn.resolveFields(); turn.regenerate(); turn.resolveExits();
  return { accepted, reason };
}
const equip = (affinityKey: string, params: { stacks?: number; intensity?: number } = {}) =>
  ({ kind: 'equip_affinity', params: { affinityKey, ...params } });

test('equipping at a lower intensity runs it there and pays 2 + range + running intensity', () => {
  const registry = corridor([actor('a', 0)]);
  expect(act(registry, 1, equip('fire:emit', { intensity: 1 })).accepted).toBe(true);
  const record = registry.getActor('a')!;
  expect(record.equippedAffinityIntensity).toEqual({ 'fire:emit': 1 });
  expect(record.affinities.find(pair => pair.kind === 'fire')!.intensity).toBe(3);
  expect(record.vitals.mana!.current).toBe(40 - (2 + 3 + 1));
  expect(equippedActorAffinities(record)).toEqual([{ kind: 'fire', expression: 'emit', stacks: 3, intensity: 1 }]);
});

test('range and intensity run low independently, in one equip', () => {
  const registry = corridor([actor('a', 0)]);
  expect(act(registry, 1, equip('fire:emit', { stacks: 2, intensity: 2 })).accepted).toBe(true);
  const record = registry.getActor('a')!;
  expect(record.equippedAffinityStacks).toEqual({ 'fire:emit': 2 });
  expect(record.equippedAffinityIntensity).toEqual({ 'fire:emit': 2 });
});

test('a cast at a lower intensity pays and hits at that intensity', () => {
  const low = corridor([actor('a', 0, { activeAffinityKey: 'water:push', equippedAffinityIntensity: { 'water:push': 1 } }),
    actor('b', 1, { affinities: [] })]);
  expect(act(low, 1, { kind: 'cast_affinity', params: { targetId: 'b' } }).accepted).toBe(true);
  // base 1 × intensity 1 × range 2·3/2 = 3 mana; 2 × 1² = 2 harm.
  expect(low.getActor('a')!.vitals.mana!.current).toBe(40 - 3);
  expect(low.getActor('b')!.vitals.health!.current).toBe(30 - 2);
  const full = corridor([actor('a', 0, { activeAffinityKey: 'water:push' }), actor('b', 1, { affinities: [] })]);
  expect(act(full, 1, { kind: 'cast_affinity', params: { targetId: 'b' } }).accepted).toBe(true);
  // base 1 × intensity 3 × 3 = 9 mana; 2 × 3² = 18 harm.
  expect(full.getActor('a')!.vitals.mana!.current).toBe(40 - 9);
  expect(full.getActor('b')!.vitals.health!.current).toBe(30 - 18);
});

test('re-equipping at another intensity changes it; omitted means full', () => {
  const registry = corridor([actor('a', 0, { activeAffinityKey: 'fire:emit', equippedAffinityIntensity: { 'fire:emit': 1 } })]);
  expect(act(registry, 1, equip('fire:emit', { intensity: 2 })).accepted).toBe(true);
  expect(registry.getActor('a')!.equippedAffinityIntensity).toEqual({ 'fire:emit': 2 });
  expect(act(registry, 2, equip('fire:emit')).accepted).toBe(true);
  expect(registry.getActor('a')).not.toHaveProperty('equippedAffinityIntensity');
  expect(act(registry, 3, equip('fire:emit'))).toEqual({ accepted: false, reason: 'AffinityAlreadyEquipped' });
});

test('an intensity outside 1..held is refused', () => {
  const registry = corridor([actor('a', 0)]);
  expect(act(registry, 1, equip('fire:emit', { intensity: 4 }))).toEqual({ accepted: false, reason: 'InvalidAffinityIntensity' });
  expect(act(registry, 2, equip('fire:emit', { intensity: 0 }))).toEqual({ accepted: false, reason: 'InvalidAffinityIntensity' });
  expect(Object.hasOwn(ValidationError, 'InvalidAffinityIntensity')).toBe(true);
});

test('unequipping drops the running intensity; a bad record is refused on load', () => {
  const registry = corridor([actor('a', 0, { activeAffinityKey: 'fire:emit', equippedAffinityIntensity: { 'fire:emit': 1 } })]);
  expect(act(registry, 1, { kind: 'unequip_affinity', params: { affinityKey: 'fire:emit' } }).accepted).toBe(true);
  expect(registry.getActor('a')).not.toHaveProperty('equippedAffinityIntensity');
  for (const running of [{ 'fire:emit': 3 }, { 'fire:emit': 0 }, { 'water:push': 1 }, {}]) {
    expect(() => corridor([actor('a', 0, { activeAffinityKey: 'fire:emit', equippedAffinityIntensity: running })])).toThrow();
  }
});

// ## TODO: Test Permutations
// - Field strength at a lower running intensity, per kind and expression (affinity-agnostic).
// - Cancel and overwhelm compare running intensity, not held intensity.
