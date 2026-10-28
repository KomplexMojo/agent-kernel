/**
 * #535 (Darren, 2026-10-28, from the #496 audit): corrode's `breach` trait. Its harm (damage and
 * steal, fields and casts alike, through the one receiver path) is doubled against a structure:
 * a receiver whose defeat vital is durability (barriers, hazards, resources). Corrode breaks
 * structures; earth builds them (#534). The rule reads the trait column, never a kind name.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import { receiverAffinityAmount } from '../../packages/core-ts/src/rules/actor-receiver.ts';
import { AFFINITY_RECEIVER_RULES, AFFINITY_TABLE, affinityTableRow } from '../../packages/core-ts/src/state/affinity-table.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x: number, slots: ActorAffinityEntry[], defeatVital: ActorRecord['defeatVital'] = 'health'): ActorRecord {
  const vital = { current: 40, max: 40, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital,
    vitals: { health: { ...vital }, mana: { ...vital }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: false, canCast: true, canEquip: true, canTake: false, canExit: false,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: slots,
    activeAffinityKey: slots[0] ? `${slots[0].kind}:${slots[0].expression}` : null, holdings: [] };
}

test('only corrode carries breach, and it doubles harm', () => {
  expect(AFFINITY_TABLE.filter(row => row.trait === 'breach').map(row => row.kind)).toEqual(['corrode']);
  expect(AFFINITY_RECEIVER_RULES.breachAmplification).toBe(2);
  expect(AFFINITY_RECEIVER_RULES.breachesDefeatVital).toBe('durability');
});

test('a breach kind doubles its push and pull against a structure, not against a delver', () => {
  for (const row of AFFINITY_TABLE) {
    for (const expression of ['push', 'pull', 'emit', 'draw'] as const) {
      const incoming = { kind: row.kind, expression };
      const structure = receiverAffinityAmount(actor('s', 1, [], 'durability'), incoming, 5);
      const delver = receiverAffinityAmount(actor('d', 1, []), incoming, 5);
      expect(delver).toBe(5);
      expect(structure).toBe(affinityTableRow(row.kind)!.trait === 'breach' ? 10 : 5);
    }
  }
});

test('a corrode push takes twice the durability from a hazard that it takes from a delver', () => {
  const pair = { kind: 'corrode', expression: 'push', stacks: 1, intensity: 2 } as const;
  const hit = (defeatVital: ActorRecord['defeatVital']) => {
    const registry = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'],
      actors: [actor('caster', 0, [pair]), actor('target', 1, [], defeatVital)] });
    expect(castFocusedActorAffinity(registry, 'caster', 'target', { castManaBase: { 'corrode:push': 0 } }).accepted).toBe(true);
    return 40 - registry.getActor('target')!.vitals.durability!.current;
  };
  expect(hit('health')).toBe(8); // push base 2 × intensity²
  expect(hit('durability')).toBe(16);
});

test('a same-kind immunity still wins: a structure that is itself corrode takes nothing', () => {
  const corrodeHazard = actor('h', 1, [{ kind: 'corrode', expression: 'emit', stacks: 1, intensity: 1 }], 'durability');
  expect(receiverAffinityAmount(corrodeHazard, { kind: 'corrode', expression: 'emit' }, 5)).toBe(0);
});

// ## TODO: Test Permutations
// - breach and an opposite (fortify) slot on the structure multiply together (×4)
// - a corrode emit field on a barrier erodes it twice as fast as on a delver's armour
// - a corrode draw absorbed by a same-kind draw on a structure goes to mana, unamplified
