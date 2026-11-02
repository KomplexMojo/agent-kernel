/**
 * AK-10 / playtest light-emit-perimeter: an emit field stops at walls. Manhattan
 * reach alone used to project through a 1-thick wall onto the far floor (and the
 * ASCII UI then painted `:` on that fog), so light showed outside its perimeter.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';
import { projectActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';

function actor(id: string, x: number, y: number, pair?: ActorAffinityEntry): ActorRecord {
  return {
    id, alignment: 'external', lifecycle: 'alive', position: { x, y },
    defeatVital: 'health',
    vitals: {
      health: { current: 10, max: 10, regen: 0 },
      mana: { current: 40, max: 40, regen: 0 },
    },
    capabilities: {
      canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false,
    },
    motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [],
  };
}

/** Two rooms split by a 1-thick wall; hero stands against the wall with light emit r2. */
function splitRooms(heroX = 2, heroY = 2) {
  const tiles = [
    '##########',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '##########',
  ];
  const width = tiles[0].length;
  const height = tiles.length;
  const terrain = tiles.flatMap((row) => [...row].map((ch) => (ch === '#' ? 'wall' : 'floor')));
  const light = { kind: 'light', expression: 'emit', stacks: 2, intensity: 1 } as const;
  return createActorRegistry({
    dimensions: { width, height },
    terrain,
    actors: [actor('hero', heroX, heroY, light)],
  });
}

test('light emit r2 does not reach floor on the far side of an adjacent wall', () => {
  const registry = splitRooms(2, 2);
  // Wall at x=3; far-side floor at (4,2) is Manhattan 2 from the hero — in range without occlusion.
  expect(Math.abs(4 - 2) + Math.abs(2 - 2)).toBe(2);
  const fields = projectActorFields(registry).fields.filter((cell) => cell.sourceId === 'hero');
  const at = (x: number, y: number) => fields.filter((cell) => cell.position.x === x && cell.position.y === y);

  expect(at(1, 2).length).toBeGreaterThan(0); // same room, adjacent
  expect(at(2, 1).length).toBeGreaterThan(0);
  expect(at(3, 2)).toEqual([]); // wall cell itself
  expect(at(4, 2)).toEqual([]); // far-side floor through the wall
  expect(at(4, 1)).toEqual([]);
  expect(at(4, 3)).toEqual([]);
});

test('open floor within Manhattan reach still receives the emit', () => {
  const width = 7;
  const height = 3;
  const terrain = Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    return y === 0 || y === 2 || x === 0 || x === 6 ? 'wall' : 'floor';
  });
  const light = { kind: 'light', expression: 'emit', stacks: 2, intensity: 1 } as const;
  const registry = createActorRegistry({
    dimensions: { width, height },
    terrain,
    actors: [actor('hero', 3, 1, light)],
  });
  const fields = projectActorFields(registry).fields.filter((cell) => cell.sourceId === 'hero');
  const reached = fields.map((cell) => `${cell.position.x},${cell.position.y}`).sort();
  expect(reached).toEqual(['1,1', '2,1', '3,1', '4,1', '5,1']);
});

// ## TODO: Test Permutations
// - a raised barrier with blocksSight stops an emit the same way a wall does
// - diagonal corner peeking is refused (same supercover rule as sight)
// - Chebyshev-corner cell at man>stacks stays out even with clear LOS
