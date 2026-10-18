/**
 * #165: a downed actor does not act. Actions resolve in order within a turn, so
 * an actor defeated earlier in the turn loses its own action (no simultaneous
 * trades), and a defeated actor is refused every action kind on later turns.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord, ActorAction } from '../../packages/core-ts/src/state/actor-types.ts';

// The two push different kinds: a same-kind push holder is immune to the other's cast (#348).
function actor(id: string, x: number, health = 10, push: 'water' | 'decay' = id === 'b' ? 'decay' : 'water'): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: health, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 },
      stamina: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: [
      { kind: push, expression: 'push', stacks: 1 }, { kind: 'light', expression: 'emit', stacks: 1 }],
    activeAffinityKey: `${push}:push`, holdings: [] } as ActorRecord;
}
const costs = { castManaBase: { 'water:push': 1, 'decay:push': 1 }, movementStamina: { a: 1, b: 1 } };
const castAt = (actorId: string, targetId: string, tick = 1) =>
  ({ actorId, tick, kind: 'cast_affinity', params: { targetId } }) as ActorAction;

test('whoever strikes first in a mutual cast wins: the downed target loses its own cast', () => {
  for (const [first, second] of [['a', 'b'], ['b', 'a']]) {
    const registry = createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain: Array(4).fill('floor'),
      actors: [actor('a', 0, 1), actor('b', 1, 1)] });
    const turn = createActorTurn(registry, 1, costs);
    expect(turn.apply(castAt(first, second))).toBe(true);
    expect(registry.getActor(second)!.lifecycle).toBe('defeated');
    expect(turn.apply(castAt(second, first))).toBe(false);
    expect(turn.lastRejection()).toBe('WrongActor');
    expect(registry.getActor(first)!.lifecycle).toBe('alive');
    expect(registry.getActor(first)!.vitals.health!.current).toBe(1);
  }
});

test('a defeated actor is refused every action kind', () => {
  const fallen = actor('b', 1, 0);
  fallen.lifecycle = 'defeated';
  const actions: ActorAction[] = [
    { actorId: 'b', tick: 1, kind: 'wait' },
    { actorId: 'b', tick: 1, kind: 'move', params: { target: { x: 2, y: 0 } } },
    { actorId: 'b', tick: 1, kind: 'equip_affinity', params: { affinityKey: 'light:emit' } },
    { actorId: 'b', tick: 1, kind: 'unequip_affinity', params: { affinityKey: 'water:push' } },
    { actorId: 'b', tick: 1, kind: 'take', params: { targetId: 'a', holdingId: 'affinity:water:push' } },
    castAt('b', 'a'),
  ] as ActorAction[];
  for (const action of actions) {
    const registry = createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain: Array(4).fill('floor'),
      actors: [actor('a', 0), structuredClone(fallen)] });
    const turn = createActorTurn(registry, 1, costs);
    expect(turn.apply(action), action.kind).toBe(false);
    expect(turn.lastRejection(), action.kind).toBe('WrongActor');
    expect(registry.getActor('b')!.position).toEqual({ x: 1, y: 0 });
  }
});
