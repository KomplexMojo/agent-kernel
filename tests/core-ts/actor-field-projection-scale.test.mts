/**
 * Vast-board field projection must walk each source's Manhattan diamond, not every
 * board cell (playtest full-budget-vast / slow movement). Equivalence: padding the
 * board with empty floor outside all radii must not change projected fields.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';
import { projectActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';

function actor(id: string, x: number, y: number, pair: ActorAffinityEntry): ActorRecord {
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
    motivations: [], affinities: [pair],
    activeAffinityKey: `${pair.kind}:${pair.expression}`, holdings: [],
  };
}

function openFloor(width: number, height: number, actors: ActorRecord[]) {
  const terrain = Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    return y === 0 || y === height - 1 || x === 0 || x === width - 1 ? 'wall' as const : 'floor' as const;
  });
  return createActorRegistry({ dimensions: { width, height }, terrain, actors });
}

function fieldKeys(registry: ReturnType<typeof createActorRegistry>) {
  return projectActorFields(registry).fields
    .map((cell) => `${cell.sourceId}@${cell.position.x},${cell.position.y}:${cell.kind}:${cell.expression}:${cell.intensity}:${cell.falloff}`)
    .sort();
}

test('padding a vast empty board outside emit radius does not change projected fields', () => {
  const light = { kind: 'light', expression: 'emit', stacks: 2, intensity: 1 } as const;
  const fire = { kind: 'fire', expression: 'emit', stacks: 3, intensity: 2 } as const;
  const compact = openFloor(11, 11, [
    actor('lantern', 5, 5, light),
    actor('brazier', 3, 5, fire),
  ]);
  const vast = openFloor(56, 56, [
    actor('lantern', 5, 5, light),
    actor('brazier', 3, 5, fire),
  ]);
  expect(fieldKeys(vast)).toEqual(fieldKeys(compact));
});

test('emit stacks=2 on a 56×56 board still only lights its diamond (regression for full-board scan)', () => {
  const light = { kind: 'light', expression: 'emit', stacks: 2, intensity: 1 } as const;
  // Radius is 3 but falloff hits 0 on the rim; non-zero field cells are Manhattan ≤2 (13 tiles).
  const registry = openFloor(56, 56, [actor('hero', 20, 20, light)]);
  const fields = projectActorFields(registry).fields.filter((cell) => cell.sourceId === 'hero');
  expect(fields.length).toBeGreaterThan(0);
  expect(fields.every((cell) => Math.abs(cell.position.x - 20) + Math.abs(cell.position.y - 20) <= 2)).toBe(true);
  expect(fields).toHaveLength(13);
});
