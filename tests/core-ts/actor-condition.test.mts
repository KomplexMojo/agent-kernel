/**
 * #692 (Darren, 2026-11-02) — hit condition bands. A landed hit tells the attacker's side how hurt
 * the target is, in words: a band on its defeat vital, a hit word scaled to the vital's max, and
 * whether the receiver amplified or resisted it. Fractions of max only; never a number.
 * Affinity-agnostic: every kind is checked alike.
 */
import { expect, test } from 'vitest';
import { actorConditionBand, actorHitWord, ACTOR_CONDITION_BANDS, ACTOR_CONDITION_FADE_TICKS }
  from '../../packages/core-ts/src/rules/actor-condition.ts';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import { getOppositeAffinityKind } from '../../packages/core-ts/src/state/affinity.ts';
import { AFFINITY_KIND_BY_CODE } from '../../packages/core-ts/src/affinity-readers.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

test('the band reads the fraction of max left: unhurt, hurt, bloodied, near defeat', () => {
  expect(ACTOR_CONDITION_BANDS).toEqual(['unhurt', 'hurt', 'bloodied', 'near_defeat']);
  expect(actorConditionBand(20, 20)).toBe('unhurt');
  expect(actorConditionBand(16, 20)).toBe('unhurt');
  expect(actorConditionBand(15, 20)).toBe('hurt');
  expect(actorConditionBand(11, 20)).toBe('hurt');
  expect(actorConditionBand(10, 20)).toBe('bloodied');
  expect(actorConditionBand(6, 20)).toBe('bloodied');
  expect(actorConditionBand(5, 20)).toBe('near_defeat');
  expect(actorConditionBand(0, 20)).toBe('near_defeat');
  expect(actorConditionBand(5, 0)).toBeNull();
  expect(ACTOR_CONDITION_FADE_TICKS).toBe(5);
});

test('the hit word scales the loss to the vital max: glancing, solid, crushing', () => {
  expect(actorHitWord(1, 20)).toBe('glancing');
  expect(actorHitWord(2, 20)).toBe('solid');
  expect(actorHitWord(4, 20)).toBe('solid');
  expect(actorHitWord(5, 20)).toBe('crushing');
  expect(actorHitWord(0, 20)).toBeNull();
});

const KINDS = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;
const KIND_CODES = Object.fromEntries(Object.entries(AFFINITY_KIND_BY_CODE).map(([code, name]) => [name, Number(code)]));
const opposite = (kind: string) => AFFINITY_KIND_BY_CODE[getOppositeAffinityKind(KIND_CODES[kind])];
function actor(id: string, x: number, slots: ActorAffinityEntry[]): ActorRecord {
  const vital = { current: 30, max: 40, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { ...vital }, mana: { ...vital }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: slots,
    activeAffinityKey: slots[0] ? `${slots[0].kind}:${slots[0].expression}` : null, holdings: [] };
}
function castAt(kind: string, receiver: ActorAffinityEntry[]) {
  const pair = { kind, expression: 'push', stacks: 1, intensity: 1 } as ActorAffinityEntry;
  const registry = createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: Array(3).fill('floor'),
    actors: [actor('caster', 0, [pair]), actor('target', 1, receiver)] });
  return castFocusedActorAffinity(registry, 'caster', 'target', { castManaBase: { [`${kind}:push`]: 0 } });
}

test('a cast records how the receiver took it: amplified by an opposite slot, resisted by a same-kind push', () => {
  for (const kind of KINDS) {
    const plain = castAt(kind, []);
    expect(plain.accepted).toBe(true);
    expect((plain as { reception?: string }).reception).toBeUndefined();
    const same = castAt(kind, [{ kind, expression: 'push', stacks: 1, intensity: 1 } as ActorAffinityEntry]);
    expect((same as { reception?: string }).reception, kind).toBe('resisted');
  }
  // Opposite slots double harm (damage and drain): every harmful push meets one.
  for (const kind of ['fire', 'water', 'earth', 'wind', 'decay', 'corrode', 'dark']) {
    const doubled = castAt(kind, [{ kind: opposite(kind), expression: 'emit', stacks: 1, intensity: 1 } as ActorAffinityEntry]);
    expect((doubled as { reception?: string }).reception, kind).toBe('amplified');
  }
});
