/**
 * #273: stamina recovers only on turns an actor does not move. Walking drains,
 * waiting (or any other action) refills, for every actor alike.
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

test('a move drains stamina by its cost with no regen that turn; other vitals still regenerate', () => {
  const registry = world();
  registry.changeVital('a', 'mana', -5);
  const turn = createActorTurn(registry, 1, costs);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 1, y: 0 } } })).toBe(true);
  endTurn(turn);
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(9);
  expect(registry.getActor('a')!.vitals.mana!.current).toBe(6);
});

test('walking keeps draining; resting refills at the regen rate', () => {
  const registry = world();
  for (let tick = 1; tick <= 3; tick += 1) {
    const turn = createActorTurn(registry, tick, costs);
    turn.apply({ actorId: 'a', tick, kind: 'move', params: { target: { x: tick, y: 0 } } });
    endTurn(turn);
  }
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(7);
  const rest = createActorTurn(registry, 4, costs);
  rest.apply({ actorId: 'a', tick: 4, kind: 'wait' });
  endTurn(rest);
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(8);
});

test('an actor that did not move regenerates stamina as before, even without acting', () => {
  const registry = world();
  registry.changeVital('b', 'stamina', -4);
  const turn = createActorTurn(registry, 1, costs);
  turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 1, y: 0 } } });
  endTurn(turn);
  expect(registry.getActor('b')!.vitals.stamina!.current).toBe(7);
});

test('a refused move is not a move: stamina still regenerates', () => {
  const registry = world();
  registry.changeVital('a', 'stamina', -4);
  const turn = createActorTurn(registry, 1, costs);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 3, y: 0 } } })).toBe(false);
  endTurn(turn);
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(7);
});

test('the movers survive a snapshot round trip between acting and regen', () => {
  const registry = world();
  const turn = createActorTurn(registry, 1, costs);
  turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 1, y: 0 } } });
  const restored = createActorTurn(registry, 1, costs, turn.snapshot());
  endTurn(restored);
  expect(registry.getActor('a')!.vitals.stamina!.current).toBe(9);
});

// ## TODO: Test Permutations
// - diagonal moves (cost 2 by the movement table) drain 2 with no regen
// - a mover overwhelmed on stamina (#289) by a restoring kind still gets no stamina regen
// - a snapshot saved before #273 (no movedActorIds) restores as "nobody moved"
