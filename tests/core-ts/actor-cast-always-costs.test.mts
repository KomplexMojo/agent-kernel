import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import type { ActorRecord, AffinityKind, AffinityExpression } from '../../packages/core-ts/src/state/actor-types.ts';

// #369: every use costs mana (Darren). A cast that brings mana back to its caster (a light
// pull steals mana; a light push on oneself restores it) used to refill exactly what it had
// just paid, so a full caster cast for free. The price is now taken after the effect.

const KINDS: AffinityKind[] = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'];
const OPPOSITE: Record<AffinityKind, AffinityKind> = { fire: 'water', water: 'fire', earth: 'wind', wind: 'earth',
  growth: 'decay', decay: 'growth', corrode: 'fortify', fortify: 'corrode', light: 'dark', dark: 'light' };

function actor(id: string, x: number, kind: AffinityKind, expression: AffinityExpression): ActorRecord {
  return { id, alignment: id === 'caster' ? 'dungeon' : 'external', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 30, max: 30, regen: 0 }, mana: { current: 30, max: 30, regen: 0 },
      stamina: { current: 10, max: 10, regen: 0 }, durability: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: false, blocksSight: false },
    motivations: [], affinities: [{ kind, expression, stacks: 3, intensity: 3 }], activeAffinityKey: `${kind}:${expression}`, holdings: [] } as ActorRecord;
}
const prices = { castManaBase: Object.fromEntries(KINDS.flatMap(kind => [[`${kind}:pull`, 1], [`${kind}:push`, 1]])) };
const PRICE = 6; // base 1 × 3·4/2

for (const kind of KINDS) {
  for (const expression of ['pull', 'push'] as const) {
    test(`a full caster's ${kind} ${expression} at its opposite costs its price`, () => {
      const registry = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'],
        actors: [actor('caster', 0, kind, expression), actor('target', 1, OPPOSITE[kind], 'pull')] });
      expect(castFocusedActorAffinity(registry, 'caster', 'target', prices).accepted).toBe(true);
      expect(registry.getActor('caster')!.vitals.mana!.current).toBe(30 - PRICE);
    });
  }
  test(`a full caster's ${kind} push at itself costs its price`, () => {
    const registry = createActorRegistry({ dimensions: { width: 1, height: 1 }, terrain: ['floor'],
      actors: [actor('caster', 0, kind, 'push')] });
    expect(castFocusedActorAffinity(registry, 'caster', 'caster', prices).accepted).toBe(true);
    const mana = registry.getActor('caster')!.vitals.mana!.current;
    // A mana-damaging push on oneself takes its hit too; never a free cast.
    expect(mana).toBeLessThanOrEqual(30 - PRICE);
  });
}

test('a light pull that steals more than its price still nets the caster the difference', () => {
  const caster = actor('caster', 0, 'light', 'pull'); caster.vitals.mana!.current = 10;
  const registry = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'],
    actors: [caster, actor('target', 1, 'dark', 'pull')] });
  castFocusedActorAffinity(registry, 'caster', 'target', prices);
  // Opposite doubles the drain: 2 × 3² × 2 = 36, of which the target has 30; 10 + 20 (cap) - 6.
  expect(registry.getActor('caster')!.vitals.mana!.current).toBe(24);
  expect(registry.getActor('target')!.vitals.mana!.current).toBe(0);
});

// ## TODO: Test Permutations
// - a cast at a same-kind draw holder (absorbed into its mana) costs the caster its price
// - a neutralizing pull that suppresses costs its price
// - a caster at exactly its price casts once and is left at the steal's amount
