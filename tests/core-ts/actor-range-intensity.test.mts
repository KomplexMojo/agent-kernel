import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity, actorCastRange } from '../../packages/core-ts/src/rules/actor-cast.ts';
import { actorAffinityMagnitude, getActorAffinityEffect } from '../../packages/core-ts/src/rules/actor-affinity.ts';
import { projectActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

// Range and intensity (#340, maintainer 2026-10-17): an affinity's stacks are its
// range (how far it reaches) and its intensity is its strength. A hit is the
// expression's base × intensity² (push/pull base 2, emit/draw base 1); range never
// adds strength. One rule for all ten kinds.

const KINDS = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;

function actor(id: string, x: number, pair?: ActorAffinityEntry): ActorRecord {
  const vital = { current: 50, max: 100, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { ...vital }, mana: { ...vital }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [] };
}
const corridor = (actors: ActorRecord[]) =>
  createActorRegistry({ dimensions: { width: 12, height: 1 }, terrain: Array(12).fill('floor'), actors });

test('a hit is base × intensity², whatever the range', () => {
  for (const intensity of [0, 1, 2, 3, 6]) {
    expect(actorAffinityMagnitude('push', intensity)).toBe(2 * intensity * intensity);
    expect(actorAffinityMagnitude('pull', intensity)).toBe(2 * intensity * intensity);
    expect(actorAffinityMagnitude('emit', intensity)).toBe(intensity * intensity);
    expect(actorAffinityMagnitude('draw', intensity)).toBe(intensity * intensity);
  }
  expect(actorCastRange({ kind: 'fire', expression: 'push', stacks: 6, intensity: 2 })).toBe(6);
});

test('every kind: a push moves its vital by 2 × intensity², and range changes reach only', () => {
  const costs = { castManaBase: Object.fromEntries(KINDS.map(kind => [`${kind}:push`, 0])) };
  for (const kind of KINDS) {
    const effect = getActorAffinityEffect(kind, 'push');
    if (effect.operation === 'neutralize') continue;
    const moved = (range: number, intensity: number, distance: number) => {
      const state = corridor([actor('caster', 0, { kind, expression: 'push', stacks: range, intensity }), actor('target', distance)]);
      const result = castFocusedActorAffinity(state, 'caster', 'target', costs);
      if (!result.accepted) return null;
      return result.changes.filter(change => change.actorId === 'target')
        .reduce((sum, change) => sum + Math.abs(change.delta), 0);
    };
    expect(moved(1, 2, 1), `${kind} r1 i2`).toBe(8);
    expect(moved(6, 2, 1), `${kind} r6 i2`).toBe(8);
    expect(moved(6, 2, 6), `${kind} r6 i2 at 6 tiles`).toBe(8);
    expect(moved(1, 2, 2), `${kind} r1 cannot reach 2 tiles`).toBeNull();
    expect(moved(1, 3, 1), `${kind} r1 i3`).toBe(18);
  }
});

test('every kind: an emit field reaches by range and hits by intensity²', () => {
  for (const kind of KINDS) {
    const fields = (range: number, intensity: number) =>
      projectActorFields(corridor([actor('source', 0, { kind, expression: 'emit', stacks: range, intensity })])).fields;
    const reach = (range: number) => Math.max(...fields(range, 1).map(cell => cell.position.x));
    expect(reach(4), kind).toBeGreaterThan(reach(1));
    // Intensity leaves the reach and the falloff shape alone.
    expect(fields(3, 3).map(cell => [cell.position.x, cell.falloff]), kind)
      .toEqual(fields(3, 1).map(cell => [cell.position.x, cell.falloff]));
    expect(fields(3, 3).every(cell => cell.intensity === 3), kind).toBe(true);
    const budget = (intensity: number) => projectActorFields(corridor([
      actor('source', 0, { kind, expression: 'emit', stacks: 2, intensity }), actor('receiver', 0)])).sources[0].budget;
    expect([budget(1), budget(2), budget(3)], kind).toEqual([1, 4, 9]);
  }
});

// ## TODO: Test Permutations
// - a draw field of each kind absorbs up to 1 × intensity² a turn from a matching emit.
// - a running level (#230) cuts range only; intensity runs at the level held.
// - a claim (#holdings) adds one stack of range and leaves intensity unchanged.
