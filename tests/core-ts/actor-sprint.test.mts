// #437 — sprint: a move with `via` takes two steps in one turn, `via` then `target`, for
// SPRINT_STAMINA_FACTOR/2 times the two steps' cost (3× a cardinal step for a straight
// cardinal sprint), more than regen returns. Either step blocked refuses the whole sprint.
// It is a move like any other: no resting regen, and a soaked actor pays the soak per step.
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { computeMovementStaminaCost, computeSprintStaminaCost, SPRINT_STAMINA_FACTOR } from '../../packages/core-ts/src/rules/move.ts';
import { SOAK_MOVE_STAMINA } from '../../packages/core-ts/src/rules/actor-cast.ts';
import type { ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

const W = 7;
function actor(id: string, x: number, y: number, extra: Partial<ActorRecord> = {}): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 1 }, stamina: { current: 30, max: 30, regen: 1 },
      durability: { current: 10, max: 10, regen: 1 }, mana: { current: 10, max: 10, regen: 1 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: true, blocksSight: false }, motivations: [], affinities: [], activeAffinityKey: null,
    holdings: [], ...extra } as ActorRecord;
}

function board(actors: ActorRecord[], walls: Array<[number, number]> = []) {
  const terrain = Array(W * W).fill('floor');
  for (const [x, y] of walls) terrain[y * W + x] = 'wall';
  return createActorRegistry({ dimensions: { width: W, height: W }, terrain, actors });
}

function sprint(registry: ReturnType<typeof board>, via: { x: number; y: number }, target: { x: number; y: number }, cardinal = 2) {
  const turn = createActorTurn(registry, 1, { castManaBase: {}, movementStamina: { a: cardinal, b: cardinal } });
  const accepted = turn.apply({ actorId: 'a', tick: 1, kind: 'move', params: { target, via } });
  const rejection = turn.lastRejection();
  turn.closeActions(); turn.resolveFields(); turn.regenerate(); turn.resolveExits();
  return { accepted, rejection, actor: registry.getActor('a')! };
}

test('a sprint costs 3/2 of its two steps, so 3× a cardinal step in a straight line', () => {
  expect(SPRINT_STAMINA_FACTOR).toBe(3);
  for (const cardinal of [1, 2, 3, 4]) {
    expect(computeSprintStaminaCost(false, false, cardinal)).toBe(3 * cardinal);
    const step = computeMovementStaminaCost(true, cardinal);
    expect(computeSprintStaminaCost(true, true, cardinal)).toBe(Math.ceil(3 * (2 * step) / 2));
  }
});

test('a straight sprint moves two tiles, in every direction, for more stamina than regen returns', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const registry = board([actor('a', 3, 3)]);
    const { accepted, actor: a } = sprint(registry, { x: 3 + dx, y: 3 + dy }, { x: 3 + 2 * dx, y: 3 + 2 * dy });
    expect(accepted, `${dx},${dy}`).toBe(true);
    expect(a.position).toEqual({ x: 3 + 2 * dx, y: 3 + 2 * dy });
    const cost = computeSprintStaminaCost(dx !== 0 && dy !== 0, dx !== 0 && dy !== 0, 2);
    expect(a.vitals.stamina!.current, `${dx},${dy}`).toBe(30 - cost + 1);
    expect(cost).toBeGreaterThan(1);
  }
});

test('a wall or an actor on either step refuses the whole sprint and costs nothing', () => {
  const cases: Array<[Array<[number, number]>, ActorRecord[]]> = [
    [[[4, 3]], []], [[[5, 3]], []], [[], [actor('b', 4, 3)]], [[], [actor('b', 5, 3)]],
  ];
  for (const [walls, others] of cases) {
    const registry = board([actor('a', 3, 3), ...others], walls);
    const { accepted, rejection, actor: a } = sprint(registry, { x: 4, y: 3 }, { x: 5, y: 3 });
    expect(accepted).toBe(false);
    expect(['BlockedByWall', 'ActorCollision']).toContain(rejection);
    expect(a.position).toEqual({ x: 3, y: 3 });
  }
});

test('a sprint must cover two tiles: steps that are not adjacent, or that come back, are refused', () => {
  for (const [via, target] of [[{ x: 5, y: 3 }, { x: 6, y: 3 }], [{ x: 4, y: 3 }, { x: 6, y: 3 }], [{ x: 4, y: 3 }, { x: 3, y: 3 }]]) {
    const registry = board([actor('a', 3, 3)]);
    expect(sprint(registry, via, target).accepted).toBe(false);
    expect(registry.getActor('a')!.position).toEqual({ x: 3, y: 3 });
  }
});

test('too little stamina refuses the sprint; a soaked actor pays the soak on each step', () => {
  const worn = actor('a', 3, 3); worn.vitals.stamina = { current: 5, max: 30, regen: 1 };
  const tired = board([worn]);
  expect(sprint(tired, { x: 4, y: 3 }, { x: 5, y: 3 })).toMatchObject({ accepted: false, rejection: 'InsufficientStamina' });
  const soaked = board([actor('a', 3, 3, { soaked: 3 })]);
  const { actor: a } = sprint(soaked, { x: 4, y: 3 }, { x: 5, y: 3 });
  expect(a.vitals.stamina!.current).toBe(30 - 6 - 2 * SOAK_MOVE_STAMINA + 1);
});

// ## TODO: Test Permutations
// - an L-shaped sprint (cardinal then diagonal) costs 3/2 of its mixed steps
// - an actor that cannot move cannot sprint
// - a sprint onto exit terrain starts the exit dwell like a step
