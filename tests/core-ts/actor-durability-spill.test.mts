/**
 * Durability is armour: every outward affinity that damages durability spills what
 * armour cannot absorb into health. Corrode joined fire and earth here (Darren,
 * 2026-10-15, "Spill to health"), so standing in acid eventually kills. Since #353 the
 * spill goes to the receiver's defeat vital, which is health for delvers and wardens.
 */
import { expect, test } from 'vitest';
import { evaluateActorAffinityReceiver, getActorAffinityEffect } from '../../packages/core-ts/src/rules/actor-affinity.ts';
import type { ActorVitalKind, AffinityKind } from '../../packages/core-ts/src/state/actor-types.ts';

const KINDS: AffinityKind[] = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'];

function receiver(vitals: Partial<Record<ActorVitalKind, number>>) {
  const current = { ...vitals };
  return {
    current,
    change(vital: ActorVitalKind, delta: number): number {
      if (current[vital] === undefined) return 0;
      const before = current[vital]!; current[vital] = Math.max(0, before + delta); return current[vital]! - before;
    },
  };
}

test('every kind whose outward effect damages durability spills the excess into health', () => {
  const armourKinds = KINDS.filter((kind) => {
    const effect = getActorAffinityEffect(kind, 'emit');
    return effect.operation === 'damage' && effect.vital === 'durability';
  });
  expect(armourKinds.sort()).toEqual(['corrode', 'earth', 'fire']);
  for (const kind of armourKinds) {
    for (const expression of ['push', 'emit'] as const) {
      expect(getActorAffinityEffect(kind, expression)).toMatchObject({ overflow: 'defeat' });
      const target = receiver({ durability: 2, health: 10 });
      evaluateActorAffinityReceiver(kind, expression, 5, 'health', target.change);
      expect(target.current, `${kind} ${expression}`).toEqual({ durability: 0, health: 7 });
    }
  }
});

test('corrode on intact armour only strips durability', () => {
  const target = receiver({ durability: 10, health: 10 });
  evaluateActorAffinityReceiver('corrode', 'emit', 4, 'health', target.change);
  expect(target.current).toEqual({ durability: 6, health: 10 });
});

test('an actor with no health (a barrier) just loses its durability', () => {
  const target = receiver({ durability: 2 });
  evaluateActorAffinityReceiver('corrode', 'push', 5, 'durability', target.change);
  expect(target.current).toEqual({ durability: 0 });
});

// ## TODO: Test Permutations
// - corrode spill through resolveActorFields (emit field) defeats a health-defeat delver over turns
// - fortify draw drains durability without spill
// - corrode cancelled by fortify (#290) spills only the net stacks
