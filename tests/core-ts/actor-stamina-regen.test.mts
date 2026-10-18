/**
 * #407 (replaces #273's rest-only stamina): stamina regenerates every tick, moving or not, so
 * a plain step at the default cost (1) against the default regen (1) breaks even. A turn
 * without a move is a rest and restores twice the regen. Every actor alike.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x: number): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 1 }, mana: { current: 10, max: 10, regen: 1 },
      stamina: { current: 10, max: 10, regen: 1 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null, holdings: [] };
}
const costs = { castManaBase: {}, movementStamina: { a: 1, b: 1 } };
function world() {
  return createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain: ['floor', 'floor', 'floor', 'floor'],
    actors: [actor('a', 0), actor('b', 3)] });
}
function endTurn(turn: ReturnType<typeof createActorTurn>) {
  turn.closeActions(); turn.resolveFields(); turn.regenerate();
}

test('a move costs its stamina and regen still returns that turn: walking breaks even', () => {
  const registry = world();
  registry.changeVital('a', 'mana', -5);
  for (let tick = 1; tick <= 3; tick += 1) {
    const turn = createActorTurn(registry, tick, costs);
    expect(turn.apply({ actorId: 'a', tick, kind: 'move', params: { target: { x: tick, y: 0 } } })).toBe(true);
    endTurn(turn);
  }
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(10);
  expect(registry.getActor('a')!.vitals.mana!.current).toBe(8);
});

test('a turn without a move is a rest: twice the regen', () => {
  const registry = world();
  registry.changeVital('a', 'stamina', -6);
  const rest = createActorTurn(registry, 1, costs);
  rest.apply({ actorId: 'a', tick: 1, kind: 'wait' });
  endTurn(rest);
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(6);
  // Not acting at all rests too; other vitals keep their single regen.
  registry.changeVital('b', 'stamina', -4);
  registry.changeVital('b', 'mana', -4);
  const idle = createActorTurn(registry, 2, costs);
  endTurn(idle);
  expect(registry.getActor('b')!.vitals.stamina!.current).toBe(8);
  expect(registry.getActor('b')!.vitals.mana!.current).toBe(7);
});

test('a refused move is not a move: the actor rests', () => {
  const registry = world();
  registry.changeVital('a', 'stamina', -4);
  const turn = createActorTurn(registry, 1, costs);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 3, y: 0 } } })).toBe(false);
  endTurn(turn);
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(8);
});

test('the movers survive a snapshot round trip between acting and regen', () => {
  const registry = world();
  registry.changeVital('a', 'stamina', -4);
  const turn = createActorTurn(registry, 1, costs);
  turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 1, y: 0 } } });
  const restored = createActorTurn(registry, 1, costs, turn.snapshot());
  endTurn(restored);
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(6);
});

// ## TODO: Test Permutations
// - diagonal moves (cost 2 by the movement table) drain 1 net at regen 1
// - a rester overwhelmed on stamina (#289) to a stop still gets no stamina regen
// - a snapshot saved before #273 (no movedActorIds) restores as "nobody moved"
