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

// Mana-powered light and per-turn upkeep (#200) on the unified actor registry.
// Maintainer rulings: levels are unlit; any emitted light makes the cells it
// reaches visible in line of sight; every light is powered by its mana; every
// lasting affinity (emit, draw) pays 2 + stacks a turn, and one that cannot pay
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

// 2 + stacks, indexed by stacks (what the runtime builds from the Configurator).
const UPKEEP = Array.from({ length: 11 }, (_, stacks) => (stacks === 0 ? 0 : 2 + stacks));
const costs = { castMana: {}, movementStamina: {}, persistentUpkeep: UPKEEP };

function closeTurn(registry: ReturnType<typeof corridor>, tick: number) {
  const turn = createActorTurn(registry, tick, costs);
  turn.closeActions();
  turn.resolveFields();
  turn.regenerate();
  turn.resolveExits();
}

test('a lamp lights the cells its powered stacks reach, so an unlit observer sees into them', () => {
  // Lamp at x=6 with 2 stacks lights x=3..9. The observer at 0 sees one tile on its own.
  const registry = corridor(10, [actor('self', 0), lamp('lamp', 6, 2), actor('far', 4)]);
  const light = readActorRegistryLightByCell(registry.snapshot());
  expect(Object.keys(light).sort()).toEqual(['3,0', '4,0', '5,0', '6,0', '7,0', '8,0', '9,0']);
  const ids = scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), 'self').actors.map(entry => entry.id);
  expect(ids).toContain('far');
  const visible = readActorRegistryVisibleCells(readActorRegistryObservation(registry, 0), 'self');
  expect(visible[0]).toEqual([1, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
});

test('light is powered by mana: a half-full lamp shines half as far and a drained one is dark', () => {
  const lightOf = (record: ActorRecord) => readActorRegistryLightByCell(corridor(10, [record]).snapshot());
  const half = lamp('lamp', 0, 4); half.vitals.mana = { current: 5, max: 10, regen: 0 };
  // ceil(4 * 5/10) = 2 powered stacks: emit radius 3, so x=0..3.
  expect(Object.keys(lightOf(half)).sort()).toEqual(['0,0', '1,0', '2,0', '3,0']);
  const drained = lamp('lamp', 0, 4); drained.vitals.mana = { current: 0, max: 10, regen: 0 };
  expect(lightOf(drained)).toEqual({});
  const manaless = lamp('lamp', 0, 4); delete manaless.vitals.mana;
  expect(lightOf(manaless)).toEqual({});
});

test("an observer's own sight radius follows its powered light", () => {
  const self = lamp('self', 0, 4);
  const registry = corridor(8, [self, actor('far', 4)]);
  expect(readActorRegistryVisibleCells(readActorRegistryObservation(registry, 0), 'self')[0].slice(0, 6))
    .toEqual([1, 1, 1, 1, 1, 1]);
  registry.changeVital('self', 'mana', -9);
  // 1 of 10 mana powers ceil(4/10) = 1 stack: sight 2, light reach 2.
  expect(readActorRegistryVisibleCells(readActorRegistryObservation(registry, 0), 'self')[0].slice(0, 6))
    .toEqual([1, 1, 1, 0, 0, 0]);
});

test('a lasting affinity pays 2 + stacks each turn before regen; push pays nothing', () => {
  const emitter = lamp('lamp', 0, 3); emitter.vitals.mana = { current: 20, max: 20, regen: 1 };
  const pusher = actor('pusher', 3);
  pusher.affinities = [{ kind: 'fire', expression: 'push', stacks: 3 }];
  pusher.activeAffinityKey = 'fire:push';
  const registry = corridor(6, [emitter, pusher]);
  closeTurn(registry, 0);
  expect(registry.getActor('lamp')!.vitals.mana!.current).toBe(20 - 5 + 1);
  expect(registry.getActor('pusher')!.vitals.mana!.current).toBe(10);
});

test('a source that cannot pay goes dark and projects nothing until its mana is full again', () => {
  const emitter = lamp('lamp', 0, 3); emitter.vitals.mana = { current: 6, max: 6, regen: 2 };
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
  const turn = createActorTurn(registry, 0, { castMana: {}, movementStamina: {} });
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

test('an exhausted flag survives a snapshot round trip and rejects non-booleans', () => {
  const record = lamp('lamp', 0, 3); record.affinityExhausted = true;
  expect(corridor(4, [record]).snapshot().actors[0].affinityExhausted).toBe(true);
  const bad = { ...lamp('lamp', 0, 3), affinityExhausted: 'yes' } as unknown as ActorRecord;
  expect(() => corridor(4, [bad])).toThrow();
});
