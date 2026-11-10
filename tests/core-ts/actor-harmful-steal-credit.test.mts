/**
 * #832 (Darren, 2026-11-10): a harmful kind's steal credits its caster with half of what the
 * primary vital gave up, rounded down. It used to credit all of it, so a pull was a push with a
 * free refill (decay pull went 17-0 in the balance duels and ended each fight at full health).
 * The harm is unchanged, and a restoring kind's top-up (#537) still credits in full.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x: number, slots: ActorAffinityEntry[], health = 50): ActorRecord {
  const vital = { current: 50, max: 100, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { ...vital, current: health }, mana: { ...vital }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: slots,
    activeAffinityKey: slots[0] ? `${slots[0].kind}:${slots[0].expression}` : null, holdings: [] };
}

function pull(kind: 'decay' | 'growth' | 'dark', intensity: number, targetHealth = 50) {
  const pair = { kind, expression: 'pull', stacks: 1, intensity } as const;
  const state = createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: Array(3).fill('floor'),
    actors: [actor('caster', 0, [pair]), actor('target', 1, [], targetHealth)] });
  expect(castFocusedActorAffinity(state, 'caster', 'target', { castManaBase: { [`${kind}:pull`]: 0 } }).accepted).toBe(true);
  return { caster: state.getActor('caster')!.vitals, target: state.getActor('target')!.vitals };
}

test('a decay pull takes 8 health and gives its caster 4', () => {
  const { caster, target } = pull('decay', 2);
  expect(target.health!.current).toBe(42);
  expect(caster.health!.current).toBe(54);
});

test('the half rounds down: an intensity-3 dark pull takes 18 mana and gives 9; 3 taken gives 1', () => {
  const dark = pull('dark', 3);
  expect(dark.target.mana!.current).toBe(32);
  expect(dark.caster.mana!.current).toBe(59);
  const scraps = pull('decay', 2, 3);
  expect(scraps.target.health!.current).toBe(0);
  expect(scraps.caster.health!.current).toBe(51);
});

test('a restoring kind still tops up in full (#537)', () => {
  const { caster, target } = pull('growth', 2);
  expect(target.health!.current).toBe(42);
  expect(caster.health!.current).toBe(58);
});

// ## TODO: Test Permutations
// - a draw field's steal credits half as well
// - every harmful kind (fire, water, earth, wind, decay, corrode, dark) at intensity 1..3
// - a caster at full vital gains nothing and the target still loses the whole amount
