import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';
import {
  readActorRegistryDarkByCell,
  readActorRegistryDarkCells,
  readActorRegistryObservation,
  readActorRegistryVisibleCells,
  scopeActorRegistryObservation,
} from '../../packages/core-ts/src/rules/actor-observation.ts';

// Dark against light by stacks (#203, maintainer 2026-10-12): "the dark affinity
// keeps a character and area dark based on the affinity stack as compared to
// countering affinity stacks like light." Per cell, the strongest powered dark
// stacks reaching it are weighed against the strongest powered light stacks:
// more dark is dark, more light is lit, a tie is neither.

function actor(id: string, x: number): ActorRecord {
  return { id, position: { x, y: 0 }, alignment: 'dungeon', lifecycle: 'alive', defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}

function emitting(record: ActorRecord, kind: 'light' | 'dark', stacks: number): ActorRecord {
  record.affinities = [{ kind, expression: 'emit', stacks }];
  record.activeAffinityKey = `${kind}:emit`;
  return record;
}

function corridor(actors: ActorRecord[], width = 12) {
  return createActorRegistry({ dimensions: { width, height: 1 }, terrain: Array(width).fill('floor'), actors });
}

const seen = (registry: ReturnType<typeof corridor>, observer: string) =>
  scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), observer).actors.map(entry => entry.id);

test('a dark actor stays hidden while its dark stacks outweigh the light reaching it', () => {
  // A 2-stack shade at x=4. Self's 3-stack light reaches x<=4 with 3 stacks: light wins there.
  expect(seen(corridor([emitting(actor('self', 0), 'light', 3), emitting(actor('shade', 4), 'dark', 2)]), 'self'))
    .toContain('shade');
  // Self's 2-stack light stops at x=3, so only dark reaches the shade: it stays hidden.
  expect(seen(corridor([emitting(actor('self', 0), 'light', 2), emitting(actor('shade', 4), 'dark', 2)]), 'self'))
    .not.toContain('shade');
});

test('one net dark stack is enough to darken a cell; there is no separate threshold', () => {
  const registry = corridor([actor('self', 0), emitting(actor('shade', 6), 'dark', 1)]);
  // 1-stack dark reaches x=4..8 (Manhattan radius 2).
  expect(readActorRegistryDarkCells(readActorRegistryObservation(registry, 0))[0])
    .toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0]);
});

test('equal light and dark cancel: the cell is neither lit nor dark', () => {
  const registry = corridor([actor('self', 0), emitting(actor('lamp', 5), 'light', 2), emitting(actor('shade', 5), 'dark', 2)]);
  const observation = readActorRegistryObservation(registry, 0);
  expect(readActorRegistryDarkCells(observation)[0].every(cell => cell === 0)).toBe(true);
  // Not lit either, so from x=0 nothing near the pair is seen.
  expect(readActorRegistryVisibleCells(observation, 'self')[0].slice(3)).toEqual(Array(9).fill(0));
});

test("dark at the observer's tile is subtracted from its own light", () => {
  const target = () => actor('target', 2);
  expect(seen(corridor([emitting(actor('self', 0), 'light', 3), target()]), 'self')).toContain('target');
  // A 3-stack shade at x=3 reaches x=0 with 3 stacks: self's own light nets to 0, sight 1.
  expect(seen(corridor([emitting(actor('self', 0), 'light', 3), target(), emitting(actor('shade', 3), 'dark', 3)]), 'self'))
    .not.toContain('target');
});

test('dark is powered by mana like light: a half-full shade shines half its range and intensity', () => {
  const shade = emitting(actor('shade', 6), 'dark', 4);
  shade.affinities[0].intensity = 4;
  shade.vitals.mana!.current = 5;
  // ceil(4 × 5/10) = 2 for both: intensity 2, reaching emit radius 3.
  const dark = readActorRegistryDarkByCell(corridor([shade]).snapshot());
  expect(dark['6,0']).toBe(2);
  expect(dark['3,0']).toBe(2);
  expect(dark['2,0']).toBeUndefined();
});

// ## TODO: Test Permutations
// - a dark cell is seen from one tile away even when dark wins there
// - the stronger of two overlapping dark sources decides the cell
// - a drained (exhausted) shade darkens nothing
// - a wall between observer and a lit cell still blocks it
