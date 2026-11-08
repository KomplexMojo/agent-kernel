import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

// #408 (Darren, 2026-10-24): each turn a leader pays mana upkeep for every living minion bound
// to it, after affinity upkeep. A leader that cannot pay lapses that minion's bond (it stops
// taking orders) until the leader's mana is full again; the minion is never destroyed.

function actor(id: string, x: number, extra: Partial<ActorRecord> = {}, mana = { current: 3, max: 3, regen: 0 }): ActorRecord {
  return { id, position: { x, y: 0 }, alignment: 'external', lifecycle: 'alive', defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { ...mana } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null, holdings: [],
    ...extra } as ActorRecord;
}
const UPKEEP = 1;
const costs = { castManaBase: {}, movementStamina: {}, minionUpkeep: UPKEEP };

function setup(leaderMana = { current: 3, max: 3, regen: 0 }, minions = ['m1', 'm2']) {
  return createActorRegistry({ dimensions: { width: 6, height: 1 }, terrain: Array(6).fill('floor'),
    actors: [actor('lead', 0, {}, leaderMana), ...minions.map((id, index) => actor(id, index + 1, { minionOf: 'lead' }))] });
}
function turn(registry: ReturnType<typeof setup>, tick: number, turnCosts: object = costs) {
  const t = createActorTurn(registry, tick, turnCosts as typeof costs);
  t.closeActions(); t.resolveFields(); t.regenerate(); t.resolveExits();
}
const mana = (registry: ReturnType<typeof setup>, id = 'lead') => registry.getActor(id)!.vitals.mana!.current;

test('the leader pays the upkeep for each living minion, every turn', () => {
  const registry = setup({ current: 10, max: 10, regen: 0 });
  turn(registry, 0);
  expect(mana(registry)).toBe(10 - 2 * UPKEEP);
  turn(registry, 1);
  expect(mana(registry)).toBe(10 - 4 * UPKEEP);
  // The minions pay nothing of their own.
  expect(mana(registry, 'm1')).toBe(3);
});

test('no upkeep handed in charges nothing', () => {
  const registry = setup();
  turn(registry, 0, { castManaBase: {}, movementStamina: {} });
  expect(mana(registry)).toBe(3);
});

test('a defeated minion costs nothing', () => {
  const registry = createActorRegistry({ dimensions: { width: 6, height: 1 }, terrain: Array(6).fill('floor'),
    actors: [actor('lead', 0), actor('m1', 1, { minionOf: 'lead', lifecycle: 'defeated',
      vitals: { health: { current: 0, max: 10, regen: 0 }, mana: { current: 3, max: 3, regen: 0 } } })] });
  turn(registry, 0);
  expect(mana(registry)).toBe(3);
});

test('a leader that cannot pay lapses the bond, in id order, and pays nothing for it', () => {
  const registry = setup({ current: 1, max: 3, regen: 0 });
  turn(registry, 0);
  expect(mana(registry)).toBe(0);
  expect(registry.getActor('m1')!.bondLapsed).toBeUndefined();
  expect(registry.getActor('m2')!.bondLapsed).toBe(true);
  turn(registry, 1);
  expect(registry.getActor('m1')!.bondLapsed).toBe(true);
  // Lapsed, never destroyed.
  expect(registry.getActor('m1')!.lifecycle).toBe('alive');
  expect(mana(registry)).toBe(0);
});

test('the bond holds again once the leader\'s mana is full', () => {
  const registry = setup({ current: 0, max: 4, regen: 2 });
  turn(registry, 0); // pays nothing, both lapse, regen to 2
  expect(registry.getActor('m1')!.bondLapsed).toBe(true);
  turn(registry, 1); // regen to 4 = full: the bonds hold again
  expect(mana(registry)).toBe(4);
  expect(registry.getActor('m1')!.bondLapsed).toBeUndefined();
  expect(registry.getActor('m2')!.bondLapsed).toBeUndefined();
  turn(registry, 2); // and cost again
  expect(mana(registry)).toBe(4 - 2 * UPKEEP + 2);
});

test('affinity upkeep is paid first; the minions get what is left', () => {
  const emit = { kind: 'fire' as const, expression: 'emit' as const, stacks: 1, intensity: 1 };
  const registry = createActorRegistry({ dimensions: { width: 6, height: 1 }, terrain: Array(6).fill('floor'),
    actors: [actor('lead', 0, { affinities: [emit], activeAffinityKey: 'fire:emit' }, { current: 4, max: 4, regen: 0 }),
      actor('m1', 1, { minionOf: 'lead' })] });
  // Upkeep table: index 2 (range 1 + intensity 1²) costs 4, all of the leader's mana.
  turn(registry, 0, { ...costs, persistentUpkeep: [0, 3, 4] });
  expect(mana(registry)).toBe(0);
  expect(registry.getActor('lead')!.affinityExhausted).toBeUndefined();
  expect(registry.getActor('m1')!.bondLapsed).toBe(true);
});

test('a dead leader charges nothing and its minion keeps its state', () => {
  const registry = createActorRegistry({ dimensions: { width: 6, height: 1 }, terrain: Array(6).fill('floor'),
    actors: [actor('lead', 0, { lifecycle: 'defeated', vitals: { health: { current: 0, max: 10, regen: 0 }, mana: { current: 3, max: 3, regen: 0 } } }),
      actor('m1', 1, { minionOf: 'lead' })] });
  turn(registry, 0);
  expect(mana(registry)).toBe(3);
  expect(registry.getActor('m1')!.bondLapsed).toBeUndefined();
});

test('the registry refuses a bad bond', () => {
  const build = (records: ActorRecord[]) => () => createActorRegistry({ dimensions: { width: 6, height: 1 },
    terrain: Array(6).fill('floor'), actors: records });
  expect(build([actor('a', 0, { minionOf: 'a' })])).toThrow(/minionOf/);
  expect(build([actor('a', 0, { minionOf: 'nobody' })])).toThrow(/minionOf/);
  expect(build([actor('a', 0, { bondLapsed: true })])).toThrow(/bondLapsed/);
  expect(build([actor('lead', 0), actor('a', 1, { minionOf: 'lead', bondLapsed: false as unknown as true })])).toThrow(/bondLapsed/);
  expect(() => createActorTurn(setup(), 0, { ...costs, minionUpkeep: -1 })).toThrow(/invalid action costs/);
});

// ## TODO: Test Permutations
// - a leader with no mana pool: every bond lapses on the first turn and never holds again
// - two leaders, each paying only for its own minions
// - a minion whose leader exited the level: no charge
// - minion upkeep above max mana: the bonds full mana can pay hold, the rest stay lapsed
