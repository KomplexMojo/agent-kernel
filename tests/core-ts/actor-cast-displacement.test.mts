// #419, #482 (Darren, 2026-10-26) — every kind's landed cast moves what it hits: a push away
// from the caster, a pull toward it, one cell per point of intensity, each step only into a
// free cell (a wall or an actor stops it, with no extra harm). Kinds are read off the table.
// #536 (Darren, 2026-10-28): times the kind's `displaceSteps` column, so wind moves it twice as far.
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { castFocusedActorAffinity } from '../../packages/core-ts/src/rules/actor-cast.ts';
import { AFFINITY_TABLE } from '../../packages/core-ts/src/state/affinity-table.ts';
import type { ActorRecord, ActorAffinityEntry, AffinityKind } from '../../packages/core-ts/src/state/actor-types.ts';

const W = 9;
const CENTRE = { x: 4, y: 4 };
const DISPLACERS = AFFINITY_TABLE.map(row => row.kind);
const steps = (kind: AffinityKind) => AFFINITY_TABLE.find(row => row.kind === kind)!.displaceSteps;

function actor(id: string, position: { x: number; y: number }, pair?: ActorAffinityEntry): ActorRecord {
  return { id, alignment: id === 'source' ? 'external' : 'dungeon', lifecycle: 'alive', position: { ...position },
    defeatVital: 'health', vitals: { health: { current: 50, max: 50, regen: 0 }, stamina: { current: 50, max: 50, regen: 0 },
      durability: { current: 50, max: 50, regen: 0 }, mana: { current: 200, max: 200, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: true, blocksSight: false }, motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [] };
}

function cast(kind: AffinityKind, expression: 'push' | 'pull', { target = { x: 5, y: 4 }, intensity = 1,
  walls = [] as Array<{ x: number; y: number }>, others = [] as ActorRecord[] } = {}) {
  const terrain = Array(W * W).fill('floor');
  walls.forEach(({ x, y }) => { terrain[y * W + x] = 'wall'; });
  const source = actor('source', CENTRE, { kind, expression, stacks: 4, intensity });
  const state = createActorRegistry({ dimensions: { width: W, height: W }, terrain,
    actors: [source, actor('target', target), ...others] });
  const result = castFocusedActorAffinity(state, 'source', 'target', { castManaBase: { [`${kind}:${expression}`]: 1 } });
  expect(result.accepted).toBe(true);
  return { result, at: state.getActor('target')!.position, source: state.getActor('source')!.position };
}

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

test('the table names a trait per row, from a fixed set, and every kind displaces', () => {
  for (const row of AFFINITY_TABLE) expect([null, 'soak', 'spread', 'raise', 'breach']).toContain(row.trait);
  expect(DISPLACERS.length).toBe(10);
  // #536: wind knocks back twice as far; every other kind one cell per intensity.
  expect(DISPLACERS.filter(kind => steps(kind) !== 1)).toEqual(['wind']);
  expect(steps('wind')).toBe(2);
});

test('a push moves the target its kind\'s steps away from the caster, in every direction', () => {
  for (const kind of DISPLACERS) {
    for (const [dx, dy] of DIRECTIONS) {
      const target = { x: CENTRE.x + dx * 2, y: CENTRE.y + dy * 2 };
      const { at, result } = cast(kind, 'push', { target });
      expect(at, `${kind} push ${dx},${dy}`).toEqual({ x: target.x + dx * steps(kind), y: target.y + dy * steps(kind) });
      expect(result.displaced).toEqual([{ actorId: 'target', from: target, to: at }]);
    }
  }
});

test('a pull moves the target its kind\'s steps toward the caster, in every direction', () => {
  for (const kind of DISPLACERS) {
    for (const [dx, dy] of DIRECTIONS) {
      const target = { x: CENTRE.x + dx * 3, y: CENTRE.y + dy * 3 };
      expect(cast(kind, 'pull', { target }).at, `${kind} pull ${dx},${dy}`)
        .toEqual({ x: target.x - dx * steps(kind), y: target.y - dy * steps(kind) });
    }
  }
});

test('the move is the kind\'s steps per point of intensity, up to the board\'s edge or the caster', () => {
  for (const kind of DISPLACERS) {
    for (const intensity of [1, 2, 3]) {
      // The board's edge is x 8; a pull stops beside the caster at x 4.
      expect(cast(kind, 'push', { target: { x: 5, y: 4 }, intensity }).at).toEqual({ x: Math.min(8, 5 + intensity * steps(kind)), y: 4 });
      expect(cast(kind, 'pull', { target: { x: 8, y: 4 }, intensity }).at).toEqual({ x: Math.max(5, 8 - intensity * steps(kind)), y: 4 });
    }
  }
  expect(cast('wind', 'push', { target: { x: 5, y: 4 }, intensity: 1 }).at).toEqual({ x: 7, y: 4 });
});

test('a wall or an actor stops the move, with no extra harm; a far move stops where it is blocked', () => {
  for (const kind of DISPLACERS) {
    const free = cast(kind, 'push', { target: { x: 5, y: 4 } }).result.changes;
    const walled = cast(kind, 'push', { target: { x: 5, y: 4 }, walls: [{ x: 6, y: 4 }] });
    expect(walled.at).toEqual({ x: 5, y: 4 });
    expect(walled.result.changes).toEqual(free);
    expect(walled.result.displaced).toEqual([]);
    const crowded = cast(kind, 'push', { target: { x: 5, y: 4 }, others: [actor('other', { x: 6, y: 4 })] });
    expect(crowded.at).toEqual({ x: 5, y: 4 });
    expect(crowded.result.changes).toEqual(free);
    expect(cast(kind, 'push', { target: { x: 5, y: 4 }, intensity: 3, walls: [{ x: 7, y: 4 }] }).at).toEqual({ x: 6, y: 4 });
    // A pull never moves the target onto its caster.
    const adjacent = cast(kind, 'pull', { target: { x: 5, y: 4 } });
    expect(adjacent.at).toEqual({ x: 5, y: 4 });
    expect(adjacent.source).toEqual(CENTRE);
    // The board's edge stops it too.
    expect(cast(kind, 'push', { target: { x: 8, y: 4 } }).at).toEqual({ x: 8, y: 4 });
  }
});

test('something that cannot move stays put', () => {
  for (const kind of DISPLACERS) {
    const terrain = Array(W * W).fill('floor');
    const target = actor('target', { x: 5, y: 4 }); target.capabilities.canMove = false;
    const state = createActorRegistry({ dimensions: { width: W, height: W }, terrain,
      actors: [actor('source', CENTRE, { kind, expression: 'push', stacks: 3 }), target] });
    expect(castFocusedActorAffinity(state, 'source', 'target', { castManaBase: { [`${kind}:push`]: 1 } }).accepted).toBe(true);
    expect(state.getActor('target')!.position).toEqual({ x: 5, y: 4 });
  }
});

// ## TODO: Test Permutations
// - a same-kind draw that absorbs the cast leaves the target where it is
// - a target defeated by the hit is not moved
// - a diagonal two-cell push blocked on the second step stops after one
