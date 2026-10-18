/**
 * #348 — a cast meets the receiver rules a field applies: a same-kind draw absorbs it into
 * mana, a same-kind push or emit is immune, an opposite slot doubles harm. One receiver path.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import { actorFieldExposureAmount } from '../../packages/core-ts/src/rules/actor-fields.ts';
import { resolveActorExposures } from '../../packages/core-ts/src/rules/actor-exposure.ts';
import { actorAffinityMagnitude, getActorAffinityEffect } from '../../packages/core-ts/src/rules/actor-affinity.ts';
import { getOppositeAffinityKind } from '../../packages/core-ts/src/state/affinity.ts';
import { AFFINITY_KIND_BY_CODE } from '../../packages/core-ts/src/affinity-readers.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

const KINDS = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;
type Kind = typeof KINDS[number];
const KIND_CODES = Object.fromEntries(Object.entries(AFFINITY_KIND_BY_CODE).map(([code, name]) => [name, Number(code)]));
const opposite = (kind: Kind) => AFFINITY_KIND_BY_CODE[getOppositeAffinityKind(KIND_CODES[kind])] as Kind;

function actor(id: string, x: number, slots: ActorAffinityEntry[]): ActorRecord {
  const vital = { current: 10, max: 20, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { ...vital }, mana: { ...vital }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: slots,
    activeAffinityKey: slots[0] ? `${slots[0].kind}:${slots[0].expression}` : null, holdings: [] };
}

const registry = (actors: ActorRecord[]) => createActorRegistry({ dimensions: { width: 3, height: 1 },
  terrain: Array(3).fill('floor'), actors });

const RECEIVERS: Record<string, (kind: Kind) => ActorAffinityEntry[]> = {
  none: () => [],
  'same draw': kind => [{ kind, expression: 'draw', stacks: 1 }],
  'same emit': kind => [{ kind, expression: 'emit', stacks: 1, intensity: 1 }],
  'same push': kind => [{ kind, expression: 'push', stacks: 1, intensity: 1 }],
  opposite: kind => [{ kind: opposite(kind), expression: 'emit', stacks: 1, intensity: 1 }],
};

// Pull of a harmful kind neutralizes, which casts and fields handle on their own suppression
// paths; every other cast (all ten pushes, the three restoring pulls) is a direct effect.
const CASTS = KINDS.flatMap(kind => (['push', 'pull'] as const)
  .filter(expression => getActorAffinityEffect(kind, expression).operation !== 'neutralize')
  .map(expression => ({ kind, expression })));

function cast(kind: Kind, expression: 'push' | 'pull', receiverSlots: ActorAffinityEntry[]) {
  const pair = { kind, expression, stacks: 2, intensity: 2 } as const;
  const state = registry([actor('caster', 0, [pair]), actor('target', 1, receiverSlots)]);
  const result = castFocusedActorAffinity(state, 'caster', 'target', { castManaBase: { [`${kind}:${expression}`]: 0 } });
  expect(result.accepted).toBe(true);
  return state.getActor('target')!.vitals;
}

/** The same effect at the same magnitude arriving as a field: exposure, then the field's resolver. */
function field(kind: Kind, expression: 'push' | 'pull', receiverSlots: ActorAffinityEntry[]) {
  const pair = { kind, expression, stacks: 2, intensity: 2 } as const;
  const state = registry([actor('caster', 0, [pair]), actor('target', 1, receiverSlots)]);
  const magnitude = actorAffinityMagnitude(expression, 2);
  const cell = { ...pair, sourceId: 'caster', position: { x: 1, y: 0 }, falloff: 1 };
  const amount = actorFieldExposureAmount(state.getActor('target')!, cell, [cell]);
  resolveActorExposures(state, [{ sourceId: 'caster', affinityKey: `${kind}:${expression}`, budget: magnitude * 4,
    targets: amount > 0 ? [{ targetId: 'target', amount }] : [] }]);
  return state.getActor('target')!.vitals;
}

test('every direct cast meets the same receiver rules as a field at the same magnitude', () => {
  for (const { kind, expression } of CASTS) {
    for (const [name, slots] of Object.entries(RECEIVERS)) {
      expect(cast(kind, expression, slots(kind)), `${kind}:${expression} at ${name}`)
        .toEqual(field(kind, expression, slots(kind)));
    }
  }
});

test('the rules bite: a draw absorbs a push, a same-kind emitter is immune, an opposite holder takes double', () => {
  const untouched = actor('x', 0, []).vitals;
  for (const kind of KINDS) {
    const absorbed = cast(kind, 'push', RECEIVERS['same draw'](kind));
    expect(absorbed.mana!.current, `${kind} absorbed`).toBeGreaterThan(untouched.mana!.current);
    expect(cast(kind, 'push', RECEIVERS['same emit'](kind)), `${kind} immune`).toEqual(untouched);
    if (getActorAffinityEffect(kind, 'push').operation !== 'damage') continue;
    const vital = getActorAffinityEffect(kind, 'push') as { vital: 'health' | 'mana' | 'stamina' | 'durability' };
    const plain = untouched[vital.vital]!.current - cast(kind, 'push', [])[vital.vital]!.current;
    const doubled = untouched[vital.vital]!.current - cast(kind, 'push', RECEIVERS.opposite(kind))[vital.vital]!.current;
    expect(doubled, `${kind} opposite`).toBe(Math.min(2 * plain, untouched[vital.vital]!.current));
  }
});

// ## TODO: Test Permutations
// - a receiver holding both a same-kind draw and an opposite slot: the draw absorbs first
// - a cast at oneself meets no receiver rule (self-heal with a same-kind slot still lands)
// - a draw-holder at full mana absorbs nothing and takes no damage
