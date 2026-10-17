import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';
import {
  readActorRegistryObservation,
  readActorRegistryVisibleCells,
  scopeActorRegistryObservation,
} from '../../packages/core-ts/src/rules/actor-observation.ts';
import { BLINDING_DARK_STACK_THRESHOLD, BLIND_SIGHT_RADIUS, resolveVisibilityRadius } from '../../packages/core-ts/src/state/visibility.ts';

// Blinding dark (#284, maintainer 2026-10-15): when other sources' dark beats the
// light on an actor's tile by 2 or more stacks, the actor sees only its own tile.
// Net dark of 1 keeps the adjacent ring. Every actor is under the same rule, and
// an actor's own dark never blinds it.

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

const corridor = (actors: ActorRecord[], width = 12) =>
  createActorRegistry({ dimensions: { width, height: 1 }, terrain: Array(width).fill('floor'), actors });

const visibleRow = (registry: ReturnType<typeof corridor>, observer: string) =>
  readActorRegistryVisibleCells(readActorRegistryObservation(registry, 0), observer)[0];

const seen = (registry: ReturnType<typeof corridor>, observer: string) =>
  scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), observer).actors.map(entry => entry.id);

test('the radius rule: net blinding dark at 2 leaves the own tile only', () => {
  expect(BLINDING_DARK_STACK_THRESHOLD).toBe(2);
  expect(resolveVisibilityRadius({ blindingDarkStacks: 2 })).toBe(BLIND_SIGHT_RADIUS);
  expect(resolveVisibilityRadius({ blindingDarkStacks: 1 })).toBe(1);
  expect(resolveVisibilityRadius({ lightStacks: 3, blindingDarkStacks: 5 })).toBe(0);
});

test('net dark of 2 from another source blinds: only the own tile is seen', () => {
  // A 2-stack shade at x=4 reaches x=1..7; self at x=5 has no light.
  const row = visibleRow(corridor([actor('self', 5), emitting(actor('shade', 4), 'dark', 2)]), 'self');
  expect(row).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
});

test('an adjacent actor is not seen by a blinded observer', () => {
  const registry = corridor([actor('self', 5), actor('neighbour', 6), emitting(actor('shade', 4), 'dark', 3)]);
  expect(seen(registry, 'self')).not.toContain('neighbour');
});

test('net dark of 1 keeps the adjacent ring', () => {
  const row = visibleRow(corridor([actor('self', 5), emitting(actor('shade', 4), 'dark', 1)]), 'self');
  expect(row.slice(4, 7)).toEqual([1, 1, 1]);
});

test("the observer's light counts against blinding dark", () => {
  // 3 dark against the observer's own 2 light nets 1: not blind, the ring stays.
  const row = visibleRow(corridor([emitting(actor('self', 5), 'light', 2), emitting(actor('shade', 4), 'dark', 3)]), 'self');
  expect(row.slice(4, 7)).toEqual([1, 1, 1]);
  // Against 1 light it nets 2: blind.
  const blind = visibleRow(corridor([emitting(actor('self', 5), 'light', 1), emitting(actor('shade', 4), 'dark', 3)]), 'self');
  expect(blind.slice(4, 7)).toEqual([0, 1, 0]);
});

test("an actor's own dark never blinds it", () => {
  const row = visibleRow(corridor([emitting(actor('self', 5), 'dark', 3)]), 'self');
  expect(row.slice(4, 7)).toEqual([1, 1, 1]);
});

test('a blinded observer still sees lit cells in line of sight', () => {
  // A lamp at x=10 lights x=8..11; the shade blinds self at x=2.
  const row = visibleRow(corridor([actor('self', 2), emitting(actor('shade', 1), 'dark', 2),
    emitting(actor('lamp', 10), 'light', 2)]), 'self');
  expect(row[1]).toBe(0);
  expect(row[3]).toBe(0);
  expect(row[10]).toBe(1);
});

// ## TODO: Test Permutations
// - a drained shade (mana 0) does not blind; regen restores the blinding
// - two shades: the strongest, not the sum, decides
// - a blinded warden's proposals fall back to its strategy or wait
// - blindness on a 2D map: diagonal neighbours unseen too
