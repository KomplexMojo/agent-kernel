/**
 * #347 — an emit's strength is not a pool its receivers share in id order. Every receiver
 * in range takes its own exposure (falloff by distance), so renaming actors changes nothing.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { resolveActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

const KINDS = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;
const FULL = 6;
const HALF = 3;

function actor(id: string, x: number, y: number, pair?: ActorAffinityEntry): ActorRecord {
  // Half-full vitals so harmful and restoring kinds both have room to move.
  const vital = { current: HALF, max: FULL, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y },
    defeatVital: 'health', vitals: { health: { ...vital }, mana: { ...vital },
      stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [] };
}

// A source in the middle of a 5x5 board with four receivers one tile away (the #347 measurement).
const RECEIVER_CELLS = [{ x: 2, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }];

function pulse(kind: typeof KINDS[number], names: string[]) {
  const source = actor('source', 2, 2, { kind, expression: 'emit', stacks: 2, intensity: 2 });
  const receivers = RECEIVER_CELLS.map((cell, index) => actor(names[index], cell.x, cell.y));
  const registry = createActorRegistry({ dimensions: { width: 5, height: 5 }, terrain: Array(25).fill('floor'),
    actors: [source, ...receivers] });
  resolveActorFields(registry);
  // Outcome by role (the cell), not by id.
  return RECEIVER_CELLS.map((_cell, index) => registry.getActor(names[index])!.vitals);
}

const NAMINGS = [['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'], ['b', 'd', 'a', 'c']];

test('every kind: receivers at the same distance from an emit take the same amount', () => {
  for (const kind of KINDS) {
    const [first, ...rest] = pulse(kind, NAMINGS[0]);
    for (const vitals of rest) expect(vitals, kind).toEqual(first);
    expect(first, `${kind} reaches every receiver`).not.toEqual(actor('x', 0, 0).vitals);
  }
});

test('every kind: renaming the actors changes no receiver outcome', () => {
  for (const kind of KINDS) {
    const baseline = pulse(kind, NAMINGS[0]);
    for (const names of NAMINGS.slice(1)) expect(pulse(kind, names), kind).toEqual(baseline);
  }
});

// ## TODO: Test Permutations
// - receivers at two distances: the nearer always takes at least as much, whatever the ids
// - an opposite-holding receiver takes double while its neighbours take the base amount
// - a same-kind draw holder absorbs into mana without reducing what the others take
