import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { projectActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
import { equippedActorAffinities } from '../../packages/core-ts/src/state/actor-inventory.ts';
import { ValidationError } from '../../packages/core-ts/src/validate/inputs.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

// #230: an actor may run an equipped affinity at fewer stacks than it holds, to
// spend less mana. The running level decides upkeep, cast price and range, field
// reach and budget; the held stacks (what was bought, and what defeat drops) stay.

function actor(id: string, x: number, overrides: Partial<ActorRecord> = {}): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 20, max: 20, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [],
    affinities: [{ kind: 'fire', expression: 'emit', stacks: 3 }, { kind: 'water', expression: 'push', stacks: 3 }],
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
const equip = (affinityKey: string, stacks?: number) =>
  ({ kind: 'equip_affinity', params: stacks === undefined ? { affinityKey } : { affinityKey, stacks } });

test('equipping at a lower level runs it there and pays 2 + running range + intensity; held stacks stay', () => {
  const registry = corridor([actor('a', 0)]);
  expect(act(registry, 1, equip('fire:emit', 1)).accepted).toBe(true);
  const record = registry.getActor('a')!;
  expect(record.equippedAffinityStacks).toEqual({ 'fire:emit': 1 });
  expect(record.affinities.find(pair => pair.kind === 'fire')!.stacks).toBe(3);
  expect(record.vitals.mana!.current).toBe(20 - (2 + 1 + 1));
  expect(equippedActorAffinities(record)).toEqual([{ kind: 'fire', expression: 'emit', stacks: 1 }]);
});

test('the field reaches only as far as the running level', () => {
  const full = corridor([actor('a', 0, { activeAffinityKey: 'fire:emit' })]);
  const low = corridor([actor('a', 0, { activeAffinityKey: 'fire:emit', equippedAffinityStacks: { 'fire:emit': 1 } })]);
  const reach = (registry: ReturnType<typeof corridor>) =>
    Math.max(...projectActorFields(registry).fields.map(cell => cell.position.x));
  expect(reach(low)).toBeLessThan(reach(full));
});

test('a cast at a lower level pays that tier and reaches only that far', () => {
  const registry = corridor([actor('a', 0, { activeAffinityKey: 'water:push', equippedAffinityStacks: { 'water:push': 1 } }),
    actor('b', 2, { affinities: [] })]);
  expect(act(registry, 1, { kind: 'cast_affinity', params: { targetId: 'b' } }))
    .toEqual({ accepted: false, reason: 'TargetOutOfRange' });
  const near = corridor([actor('a', 0, { activeAffinityKey: 'water:push', equippedAffinityStacks: { 'water:push': 1 } }),
    actor('b', 1, { affinities: [] })]);
  expect(act(near, 1, { kind: 'cast_affinity', params: { targetId: 'b' } }).accepted).toBe(true);
  expect(near.getActor('a')!.vitals.mana!.current).toBe(20 - 1);
});

test('re-equipping at another level changes it and takes the turn; full is the default', () => {
  const registry = corridor([actor('a', 0, { activeAffinityKey: 'fire:emit', equippedAffinityStacks: { 'fire:emit': 1 } })]);
  expect(act(registry, 1, equip('fire:emit', 2)).accepted).toBe(true);
  expect(registry.getActor('a')!.equippedAffinityStacks).toEqual({ 'fire:emit': 2 });
  expect(act(registry, 2, equip('fire:emit')).accepted).toBe(true);
  expect(registry.getActor('a')).not.toHaveProperty('equippedAffinityStacks');
  expect(act(registry, 3, equip('fire:emit'))).toEqual({ accepted: false, reason: 'AffinityAlreadyEquipped' });
});

test('a level outside 1..held is refused', () => {
  const registry = corridor([actor('a', 0)]);
  expect(act(registry, 1, equip('fire:emit', 4))).toEqual({ accepted: false, reason: 'InvalidAffinityStacks' });
  expect(act(registry, 2, equip('fire:emit', 0))).toEqual({ accepted: false, reason: 'InvalidAffinityStacks' });
  expect(Object.hasOwn(ValidationError, 'InvalidAffinityStacks')).toBe(true);
});

test('unequipping drops the running level; the record is validated on load', () => {
  const registry = corridor([actor('a', 0, { activeAffinityKey: 'fire:emit', equippedAffinityStacks: { 'fire:emit': 1 } })]);
  act(registry, 1, { kind: 'unequip_affinity', params: { affinityKey: 'fire:emit' } });
  expect(registry.getActor('a')).not.toHaveProperty('equippedAffinityStacks');
  for (const equippedAffinityStacks of [{ 'water:push': 1 }, { 'fire:emit': 3 }, { 'fire:emit': 0 }]) {
    expect(() => corridor([actor('a', 0, { activeAffinityKey: 'fire:emit', equippedAffinityStacks } as Partial<ActorRecord>)]))
      .toThrow();
  }
});

// ## TODO: Test Permutations
// - a take raises held stacks and leaves the running level where it was
// - defeat holdings derive from the held affinities, not the running level
// - a running emit lights fewer cells for sight
// - each of two slots keeps its own running level
