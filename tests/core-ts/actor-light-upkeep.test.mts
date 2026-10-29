import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';
import {
  readActorRegistryLightByCell,
  readActorRegistryObservation,
  readActorRegistryVisibleCells,
  scopeActorRegistryObservation,
} from '../../packages/core-ts/src/rules/actor-observation.ts';

// Light and per-turn upkeep (#200) on the unified actor registry.
// Maintainer rulings: levels are unlit; any emitted light makes the cells it
// reaches visible in line of sight; a light shines while its affinity is on and
// goes dark when it drains (sight reads the field, #288); every lasting affinity
// (emit, draw) pays 2 + range + intensity² a turn (#340; intensity² since 2026-10-29), and one that cannot pay
// stays off until its mana regenerates to full.

function actor(id: string, x: number, y = 0): ActorRecord {
  return { id, position: { x, y }, alignment: 'dungeon', lifecycle: 'alive', defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}

function lamp(id: string, x: number, stacks: number, y = 0): ActorRecord {
  const record = actor(id, x, y);
  record.affinities = [{ kind: 'light', expression: 'emit', stacks }];
  record.activeAffinityKey = 'light:emit';
  return record;
}

function corridor(width: number, actors: ActorRecord[]) {
  return createActorRegistry({ dimensions: { width, height: 1 }, terrain: Array(width).fill('floor'), actors });
}

// 2 + n, read at n = range + intensity² (what the runtime builds from the Configurator).
const UPKEEP = Array.from({ length: 101 }, (_, stacks) => (stacks === 0 ? 0 : 2 + stacks));
const costs = { castManaBase: {}, movementStamina: {}, persistentUpkeep: UPKEEP };

function closeTurn(registry: ReturnType<typeof corridor>, tick: number) {
  const turn = createActorTurn(registry, tick, costs);
  turn.closeActions();
  turn.resolveFields();
  turn.regenerate();
  turn.resolveExits();
}

test('a lamp lights the cells its field reaches, so an unlit observer sees into them', () => {
  // Lamp at x=6 with 2 stacks lights x=4..8. The observer at 0 sees one tile on its own.
  const registry = corridor(10, [actor('self', 0), lamp('lamp', 6, 2), actor('far', 4)]);
  const light = readActorRegistryLightByCell(registry.snapshot());
  expect(Object.keys(light).sort()).toEqual(['4,0', '5,0', '6,0', '7,0', '8,0']);
  const ids = scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), 'self').actors.map(entry => entry.id);
  expect(ids).toContain('far');
  const visible = readActorRegistryVisibleCells(readActorRegistryObservation(registry, 0), 'self');
  expect(visible[0]).toEqual([1, 1, 0, 0, 1, 1, 1, 1, 1, 0]);
});

test('a lamp shines its full stacks while on, whatever its mana, and a drained one is dark (#288)', () => {
  const lightOf = (record: ActorRecord) => readActorRegistryLightByCell(corridor(10, [record]).snapshot());
  const half = lamp('lamp', 0, 4); half.vitals.mana = { current: 5, max: 10, regen: 0 };
  // Intensity 1 (the default) out to range 4, at half mana as at full.
  expect(lightOf(half)).toEqual({ '0,0': 1, '1,0': 1, '2,0': 1, '3,0': 1, '4,0': 1 });
  const drained = lamp('lamp', 0, 4); drained.affinityExhausted = true;
  expect(lightOf(drained)).toEqual({});
});

test("an observer's own sight radius follows its lit light", () => {
  const self = lamp('self', 0, 4);
  const registry = corridor(8, [self, actor('far', 4)]);
  expect(readActorRegistryVisibleCells(readActorRegistryObservation(registry, 0), 'self')[0].slice(0, 6))
    .toEqual([1, 1, 1, 1, 1, 1]);
  registry.changeVital('self', 'mana', -9);
  // Low mana does not dim a light that is on.
  expect(readActorRegistryVisibleCells(readActorRegistryObservation(registry, 0), 'self')[0].slice(0, 6))
    .toEqual([1, 1, 1, 1, 1, 1]);
  const drained = corridor(8, [{ ...lamp('self', 0, 4), affinityExhausted: true }, actor('far', 4)]);
  // Switched off, it is back to the unlit floor of 1.
  expect(readActorRegistryVisibleCells(readActorRegistryObservation(drained, 0), 'self')[0].slice(0, 6))
    .toEqual([1, 1, 0, 0, 0, 0]);
});

test('a lasting affinity pays 2 + range + intensity² each turn before regen; push pays nothing', () => {
  const emitter = lamp('lamp', 0, 3); emitter.vitals.mana = { current: 20, max: 20, regen: 1 };
  const pusher = actor('pusher', 3);
  pusher.affinities = [{ kind: 'fire', expression: 'push', stacks: 3 }];
  pusher.activeAffinityKey = 'fire:push';
  const registry = corridor(6, [emitter, pusher]);
  closeTurn(registry, 0);
  // Range 3, intensity 1 (absent): 2 + 3 + 1 = 6.
  expect(registry.getActor('lamp')!.vitals.mana!.current).toBe(20 - 6 + 1);
  const strong = lamp('lamp', 0, 3); strong.affinities[0].intensity = 3; strong.vitals.mana = { current: 20, max: 20, regen: 1 };
  const second = corridor(6, [strong]);
  closeTurn(second, 0);
  // Range 3, intensity 3: 2 + 3 + 9 = 14.
  expect(second.getActor('lamp')!.vitals.mana!.current).toBe(20 - 14 + 1);
  expect(registry.getActor('pusher')!.vitals.mana!.current).toBe(10);
});

test('a source that cannot pay goes dark and projects nothing until its mana is full again', () => {
  // Range 2 at intensity 1 pays 2 + 2 + 1 = 5 a turn.
  const emitter = lamp('lamp', 0, 2); emitter.vitals.mana = { current: 6, max: 6, regen: 2 };
  const registry = corridor(6, [emitter]);
  closeTurn(registry, 0); // pays 5 → 1, regen → 3
  expect(registry.getActor('lamp')!.affinityExhausted).toBeUndefined();
  closeTurn(registry, 1); // cannot pay 5 from 3: exhausted; regen → 5
  expect(registry.getActor('lamp')!.affinityExhausted).toBe(true);
  expect(registry.getActor('lamp')!.vitals.mana!.current).toBe(5);
  expect(readActorRegistryLightByCell(registry.snapshot())).toEqual({});
  expect(readActorRegistryObservation(registry, 2).affinityFields).toEqual([]);
  closeTurn(registry, 2); // exhausted pays nothing; regen → 6 = full: back on
  expect(registry.getActor('lamp')!.affinityExhausted).toBeUndefined();
  expect(registry.getActor('lamp')!.vitals.mana!.current).toBe(6);
  expect(Object.keys(readActorRegistryLightByCell(registry.snapshot())).length).toBeGreaterThan(0);
});

test('without an upkeep table nothing is charged', () => {
  const registry = corridor(4, [lamp('lamp', 0, 3)]);
  const turn = createActorTurn(registry, 0, { castManaBase: {}, movementStamina: {} });
  turn.closeActions(); turn.resolveFields(); turn.regenerate();
  expect(registry.getActor('lamp')!.vitals.mana!.current).toBe(10);
});

test('a lasting affinity with no mana pool cannot pay and stays off', () => {
  const record = lamp('lamp', 0, 3); delete record.vitals.mana;
  const registry = corridor(6, [record]);
  closeTurn(registry, 0);
  closeTurn(registry, 1);
  expect(registry.getActor('lamp')!.affinityExhausted).toBe(true);
  expect(readActorRegistryObservation(registry, 2).affinityFields).toEqual([]);
});

// #441: an upkeep above max mana can never be paid, so full mana does not switch it back on.
const KINDS = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;
test.each(KINDS.flatMap(kind => (['emit', 'draw'] as const).map(expression => [kind, expression] as const)))(
  'a %s %s whose upkeep exceeds max mana stays off and never runs for free (#441)', (kind, expression) => {
    const record = actor('src', 0);
    record.vitals.mana = { current: 4, max: 4, regen: 0 }; // r2 x1 costs 2 + 2 + 1 = 5
    record.affinities = [{ kind, expression, stacks: 2 }]; record.activeAffinityKey = `${kind}:${expression}`;
    const registry = corridor(6, [record]);
    for (let tick = 0; tick < 4; tick += 1) closeTurn(registry, tick);
    expect(registry.getActor('src')!.affinityExhausted).toBe(true);
    expect(registry.getActor('src')!.vitals.mana!.current).toBe(4);
    expect(readActorRegistryObservation(registry, 4).affinityFields).toEqual([]);
  });

test('of two exhausted slots, only the one full mana can pay comes back on (#441)', () => {
  const record = actor('src', 0);
  record.vitals.mana = { current: 4, max: 4, regen: 0 };
  record.affinities = [{ kind: 'earth', expression: 'emit', stacks: 2 }, { kind: 'wind', expression: 'draw', stacks: 1 }];
  record.activeAffinityKey = 'earth:emit'; record.affinitySlots = 2; record.equippedAffinityKeys = ['earth:emit', 'wind:draw'];
  record.affinityExhausted = true; // both off; wind draw r1 x1 costs 4, earth emit r2 x1 costs 5
  const registry = corridor(6, [record]);
  closeTurn(registry, 0);
  expect(registry.getActor('src')!.exhaustedAffinityKeys).toEqual(['earth:emit']);
});

test('an exhausted flag survives a snapshot round trip and rejects non-booleans', () => {
  const record = lamp('lamp', 0, 3); record.affinityExhausted = true;
  expect(corridor(4, [record]).snapshot().actors[0].affinityExhausted).toBe(true);
  const bad = { ...lamp('lamp', 0, 3), affinityExhausted: 'yes' } as unknown as ActorRecord;
  expect(() => corridor(4, [bad])).toThrow();
});
