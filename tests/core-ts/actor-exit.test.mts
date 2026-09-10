import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';
function actor(id = 'a'): ActorRecord {
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x: 0, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 5, max: 10, regen: 1 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true,
      canExit: true, blocksMovement: true, blocksSight: true }, motivations: [],
    affinities: [], activeAffinityKey: null, holdings: [] };
}
function world(actors = [actor()]) {
  return createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['exit', 'floor'], actors });
}
const costs = { castMana: {}, movementStamina: { a: 0 } };
function end(state: ReturnType<typeof world>, tick: number) {
  const turn = createActorTurn(state, tick, costs);
  expect(turn.resolveExits()).toBeNull();
  turn.closeActions(); turn.resolveFields();
  expect(turn.resolveExits()).toBeNull();
  turn.regenerate();
  const ids = turn.resolveExits();
  expect(turn.resolveExits()).toBeNull();
  return ids;
}
test('two exit ticks retire a dungeon-aligned actor and release sight and movement occupancy', () => {
  const state = world();
  expect(end(state, 1)).toEqual([]);
  expect(state.getActor('a')).toMatchObject({ lifecycle: 'alive', exitDwell: 1 });
  expect(end(state, 2)).toEqual(['a']);
  expect(state.getActor('a')).toMatchObject({ lifecycle: 'exited', exitDwell: 2, vitals: { health: { current: 7 } } });
  expect(state.getActorsAt({ x: 0, y: 0 })).toEqual([]);
  expect(state.isMovementBlocked({ x: 0, y: 0 })).toBe(false);
  expect(state.isSightBlocked({ x: 0, y: 0 })).toBe(false);
  expect(end(state, 3)).toEqual([]);
  expect(state.getActor('a')!.vitals.health!.current).toBe(7);
  expect(state.moveActor('a', { x: 1, y: 0 })).toBe(false);
});
test('leaving before the second tick resets progress; cannot bank a prior exit visit', () => {
  const state = world(); end(state, 1);
  state.moveActor('a', { x: 1, y: 0 }); end(state, 2);
  expect(state.getActor('a')!.exitDwell ?? 0).toBe(0);
  state.moveActor('a', { x: 0, y: 0 });
  expect(end(state, 3)).toEqual([]);
  expect(end(state, 4)).toEqual(['a']);
});
test('capability restrictions and defeat prevent exit progression', () => {
  const disabled = actor(); disabled.capabilities.canExit = false;
  const state = world([disabled]); end(state, 1); end(state, 2);
  expect(state.getActor('a')!.lifecycle).toBe('alive');
  const dying = world(); end(dying, 1); dying.changeVital('a', 'health', -20);
  expect(end(dying, 2)).toEqual([]);
  expect(dying.getActor('a')!.lifecycle).toBe('defeated');
});
test('registry and turn JSON restoration preserves dwell and the once-only exit phase', () => {
  const state = world(); end(state, 1);
  const turn = createActorTurn(state, 2, costs);
  turn.closeActions(); turn.resolveFields(); turn.regenerate();
  const saved = JSON.parse(JSON.stringify({ world: state.snapshot(), turn: turn.snapshot() }));
  const restored = createActorRegistry(saved.world);
  const replay = createActorTurn(restored, 2, costs, saved.turn);
  expect(turn.resolveExits()).toEqual(['a']); expect(replay.resolveExits()).toEqual(['a']);
  expect(restored.snapshot()).toEqual(state.snapshot());
  const done = createActorTurn(restored, 2, costs, JSON.parse(JSON.stringify(replay.snapshot())));
  expect(done.resolveExits()).toBeNull();
  expect(done.snapshot()).toEqual(turn.snapshot());
});
test('rejects malformed exit counters and impossible turn phase snapshots', () => {
  for (const value of [-1, 2, 3, 0.5, NaN]) {
    const record = actor(); record.exitDwell = value;
    expect(() => world([record])).toThrow();
  }
  const state = world(); const turn = createActorTurn(state, 1, costs);
  expect(() => createActorTurn(state, 1, costs, { ...turn.snapshot(), exitsResolved: true })).toThrow();
});
test('exit removal retains other occupants sharing the terrain cell', () => {
  const stays = actor('stays'); stays.capabilities.canExit = false;
  stays.capabilities.blocksMovement = false;
  const state = world([actor(), stays]); end(state, 1); end(state, 2);
  expect(state.getActorsAt({ x: 0, y: 0 }).map(record => record.id)).toEqual(['stays']);
  expect(state.isSightBlocked({ x: 0, y: 0 })).toBe(true);
});
// ## TODO: Test Permutations
// - The production Moderator must finish the exit phase once after regeneration.
