import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord, ActorAction } from '../../packages/core-ts/src/state/actor-types.ts';
function actor(id: string, x = 0): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 },
      stamina: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [
      { kind: 'fire', expression: 'push', stacks: 2 }, { kind: 'water', expression: 'push', stacks: 2 },
      { kind: 'fire', expression: 'pull', stacks: 2 }], activeAffinityKey: 'fire:push', holdings: [] };
}
function registry(records = [actor('a'), actor('b', 1)]) {
  return createActorRegistry({ dimensions: { width: 3, height: 2 }, terrain: ['floor', 'floor', 'wall', 'floor', 'floor', 'floor'], actors: records });
}
const costs = { castManaBase: { 'fire:push': 1, 'water:push': 1, 'fire:pull': 1 },
  movementStamina: { a: 1, b: 1 } };
test('equip consumes exactly one action and preserves mana; other actors may act', () => {
  const state = registry(); const turn = createActorTurn(state, 1, costs);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'equip_affinity', params: { affinityKey: 'water:push' } })).toBe(true);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'cast_affinity', params: { targetId: 'b' } })).toBe(false);
  expect(state.getActor('a')!.vitals.mana!.current).toBe(10);
  expect(turn.apply({ actorId: 'b', tick: 1, kind: 'wait' })).toBe(true);
  expect(turn.snapshot().acceptedActorIds).toEqual(['a', 'b']);
});
test('failed casts spend nothing and do not consume the action; ticks and closed state are enforced', () => {
  const a = actor('a'); a.vitals.mana!.current = 0;
  const state = registry([a, actor('b', 1)]); const turn = createActorTurn(state, 4, costs);
  expect(turn.apply({ actorId: 'a', tick: 4, kind: 'cast_affinity', params: { targetId: 'b' } })).toBe(false);
  expect(turn.apply({ actorId: 'a', tick: 3, kind: 'wait' })).toBe(false);
  expect(turn.apply({ actorId: 'a', tick: 4, kind: 'attack' } as unknown as ActorAction)).toBe(false);
  expect(turn.apply({ actorId: 'a', tick: 4, kind: 'wait' })).toBe(true);
  turn.closeActions();
  expect(turn.apply({ actorId: 'b', tick: 4, kind: 'wait' })).toBe(false);
});
test('snapshot round-trip retains action exclusivity without aliases', () => {
  const state = registry(); const turn = createActorTurn(state, 1, costs);
  turn.apply({ actorId: 'a', tick: 1, kind: 'wait' });
  const snapshot = turn.snapshot(); const restored = createActorTurn(state, 1, costs, snapshot);
  snapshot.acceptedActorIds.length = 0;
  expect(restored.apply({ actorId: 'a', tick: 1, kind: 'wait' })).toBe(false);
  expect(restored.snapshot()).toEqual(turn.snapshot());
});
test('movement preserves the existing diagonal stamina cost and fails atomically', () => {
  const state = registry(); const turn = createActorTurn(state, 1, costs); const before = state.snapshot();
  expect(turn.apply({ actorId: 'b', tick: 1, kind: 'move', params: { target: { x: 2, y: 0 } } })).toBe(false);
  expect(state.snapshot()).toEqual(before);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 1, y: 1 } } })).toBe(true);
  expect(state.getActor('a')!.vitals.stamina!.current).toBe(8);
});
test('taking consumes one action and cannot be followed by movement', () => {
  const state = registry(); state.changeVital('b', 'health', -10);
  const turn = createActorTurn(state, 1, costs);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'take', params: { targetId: 'b', holdingId: 'affinity:fire:push' } })).toBe(true);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target: { x: 1, y: 0 } } })).toBe(false);
  expect(state.getActor('a')!.affinities[0].stacks).toBe(3);
});
test('focused neutralization suppresses a later matching cast without restoring any pools', () => {
  const a = actor('a'); a.activeAffinityKey = 'fire:pull';
  const state = registry([a, actor('b', 1)]); const turn = createActorTurn(state, 1, costs);
  expect(turn.apply({ actorId: 'a', tick: 1, kind: 'cast_affinity', params: { targetId: 'b' } })).toBe(true);
  expect(turn.apply({ actorId: 'b', tick: 1, kind: 'cast_affinity', params: { targetId: 'a' } })).toBe(true);
  expect(state.getActor('a')!.vitals.health!.current).toBe(10);
  // b still pays its own push: base 1 at 2 stacks is 1 × 2 × 3 / 2 = 3 (#232).
  expect(state.getActor('b')!.vitals.mana!.current).toBe(7);
  expect(turn.snapshot().suppressions).toEqual([]);
});

test('equipment then exactly one field pass and regeneration survive snapshot restoration', () => {
  const a = actor('a'); a.affinities = [{ kind: 'fire', expression: 'emit', stacks: 1 },
    { kind: 'fire', expression: 'draw', stacks: 2 }]; a.activeAffinityKey = 'fire:emit';
  a.vitals.mana!.current = 0; a.vitals.mana!.regen = 1;
  const b = actor('b'); b.affinities = [{ kind: 'fire', expression: 'emit', stacks: 3 }]; b.activeAffinityKey = 'fire:emit';
  const state = registry([a, b]); const turn = createActorTurn(state, 1, costs);
  expect(turn.resolveFields()).toBeNull();
  expect(turn.regenerate()).toBe(false);
  turn.apply({ actorId: 'a', tick: 1, kind: 'equip_affinity', params: { affinityKey: 'fire:draw' } });
  expect(state.getActor('a')!.vitals.mana!.current).toBe(0);
  turn.closeActions();
  expect(turn.resolveFields()!.absorptions.reduce((sum, entry) => sum + entry.amount, 0)).toBe(3);
  expect(state.getActor('a')!.vitals.mana!.current).toBe(3);
  const restored = createActorTurn(state, 1, costs, turn.snapshot());
  expect(restored.resolveFields()).toBeNull();
  expect(restored.regenerate()).toBe(true);
  expect(restored.regenerate()).toBe(false);
  expect(state.getActor('a')!.vitals.mana!.current).toBe(4);
  expect(createActorTurn(state, 1, costs, restored.snapshot()).regenerate()).toBe(false);
});
test('focused suppression remains effective across restore and does not destroy equipment', () => {
  const a = actor('a'); a.activeAffinityKey = 'fire:pull';
  const b = actor('b'); b.affinities = [{ kind: 'fire', expression: 'emit', stacks: 3 }]; b.activeAffinityKey = 'fire:emit';
  const state = registry([a, b]); const turn = createActorTurn(state, 1, costs);
  turn.apply({ actorId: 'a', tick: 1, kind: 'cast_affinity', params: { targetId: 'b' } });
  const restored = createActorTurn(state, 1, costs, turn.snapshot()); restored.closeActions();
  const result = restored.resolveFields()!;
  expect(result.suppressions).toEqual([{ sourceId: 'a', targetId: 'b', amount: 3 }]);
  expect(result.fields.some(field => field.sourceId === 'b')).toBe(false);
  expect(state.getActor('a')!.vitals.health!.current).toBe(10);
  expect(state.getActor('b')!.affinities[0].stacks).toBe(3);
});
test('defeated actors cannot emit or regenerate in a closed turn', () => {
  const a = actor('a'); a.activeAffinityKey = 'water:push';
  const b = actor('b', 1); b.vitals.health!.current = 2; b.vitals.health!.regen = 5;
  b.affinities = [{ kind: 'fire', expression: 'emit', stacks: 3 }]; b.activeAffinityKey = 'fire:emit';
  const state = registry([a, b]); const turn = createActorTurn(state, 1, costs);
  turn.apply({ actorId: 'a', tick: 1, kind: 'cast_affinity', params: { targetId: 'b' } });
  turn.closeActions(); expect(turn.resolveFields()!.fields).toEqual([]); turn.regenerate();
  expect(state.getActor('b')!.vitals.health!.current).toBe(0);
});
// ## TODO: Test Permutations
// - Public core/Moderator integration must preserve these state flags in replay frames.
