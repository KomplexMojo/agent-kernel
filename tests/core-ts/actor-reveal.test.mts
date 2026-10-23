import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import {
  readActorRegistryObservation, readActorRegistryRevealLevels, readActorRegistryVisibleCells, revealedValue,
} from '../../packages/core-ts/src/rules/actor-observation.ts';
import { AFFINITY_TABLE } from '../../packages/core-ts/src/state/affinity-table.ts';
import type { ActorRecord, AffinityKind } from '../../packages/core-ts/src/state/actor-types.ts';

// #416 (Darren, 2026-10-18): light reveals an actor's properties up to its net intensity;
// dark hides them; fire lights a cell for sight but reveals nothing. Each is a column of the
// one affinity table, and sight and reveal read the columns.

function actor(id: string, x: number, emits: { kind: AffinityKind; stacks: number; intensity: number }[] = []): ActorRecord {
  const affinities = emits.map(({ kind, stacks, intensity }) => ({ kind, expression: 'emit' as const, stacks, intensity }));
  const keys = affinities.map(pair => `${pair.kind}:emit` as const);
  return { id, alignment: id === 'observer' ? 'external' : 'dungeon', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 50, max: 50, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: false, blocksSight: false },
    motivations: [], affinitySlots: 2, affinities, activeAffinityKey: keys[0] ?? null,
    ...(keys.length > 1 ? { equippedAffinityKeys: keys } : {}), holdings: [] } as ActorRecord;
}
const room = (actors: ActorRecord[], width = 8) => createActorRegistry({
  dimensions: { width, height: 1 }, terrain: Array(width).fill('floor'), actors });
const levels = (actors: ActorRecord[]) => readActorRegistryRevealLevels(readActorRegistryObservation(room(actors), 0), 'observer');

test('the table marks light as illuminating and revealing, fire as illuminating, dark as concealing', () => {
  expect(AFFINITY_TABLE.filter(row => row.illuminates).map(row => row.kind)).toEqual(['fire', 'light']);
  expect(AFFINITY_TABLE.filter(row => row.reveals).map(row => row.kind)).toEqual(['light']);
  expect(AFFINITY_TABLE.filter(row => row.conceals).map(row => row.kind)).toEqual(['dark']);
});

for (const row of AFFINITY_TABLE) {
  test(`a ${row.kind} emit on an actor's cell ${row.reveals ? 'reveals it up to its intensity' : 'reveals nothing'}`, () => {
    const found = levels([actor('observer', 0), actor('target', 3), actor('source', 4, [{ kind: row.kind, stacks: 2, intensity: 2 }])]);
    expect(found.target).toBe(row.reveals ? 2 : 0);
  });

  test(`a ${row.kind} field ${row.illuminates ? 'lights' : 'does not light'} a cell for an observer's sight`, () => {
    const observation = readActorRegistryObservation(room([actor('observer', 0),
      actor('source', 5, [{ kind: row.kind, stacks: 1, intensity: 2 }])]), 0);
    const visible = readActorRegistryVisibleCells(observation, 'observer');
    expect(visible[0][4]).toBe(row.illuminates ? 1 : 0);
  });
}

test('with nothing revealing it, an actor shows its glyph and role only (level 0)', () => {
  expect(levels([actor('observer', 0), actor('target', 1)]).target).toBe(0);
});

test('dark cancels light by intensity on the cell', () => {
  const light = actor('lamp', 4, [{ kind: 'light', stacks: 2, intensity: 3 }]);
  expect(levels([actor('observer', 0), actor('target', 3), light, actor('shade', 2, [{ kind: 'dark', stacks: 1, intensity: 1 }])]).target).toBe(2);
  expect(levels([actor('observer', 0), actor('target', 3), light, actor('shade', 2, [{ kind: 'dark', stacks: 1, intensity: 3 }])]).target).toBe(0);
});

test("an actor's own dark hides it; the observer's own dark never hides anyone from it", () => {
  const lamp = actor('lamp', 4, [{ kind: 'light', stacks: 2, intensity: 2 }]);
  expect(levels([actor('observer', 0), actor('target', 3, [{ kind: 'dark', stacks: 1, intensity: 2 }]), lamp]).target).toBe(0);
  expect(levels([actor('observer', 2, [{ kind: 'dark', stacks: 2, intensity: 3 }]), actor('target', 3), lamp]).target).toBe(2);
});

test('a value above the reveal level reads as the level with a plus', () => {
  for (let level = 1; level <= 4; level += 1) {
    for (let value = 0; value <= 6; value += 1) {
      expect(revealedValue(value, level)).toBe(value > level ? `${level}+` : value);
    }
  }
});

// ## TODO: Test Permutations
// - a revealing field that reaches the target at falloff but still at intensity reveals at that intensity
// - two revealing sources on one cell reveal at the stronger
// - an exhausted (drained) light emit reveals nothing
