import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { readActorRegistryObservation, scopeActorRegistryObservation } from '../../packages/core-ts/src/rules/actor-observation.ts';
import {
  RAISED_BARRIER_TILE_KIND, raisedBarrierStats, raisedBarrierCells,
} from '../../packages/core-ts/src/rules/actor-cast.ts';
import { affinityTableRow } from '../../packages/core-ts/src/state/affinity-table.ts';
import type { ActorRecord, AffinityKind, AffinityExpression } from '../../packages/core-ts/src/state/actor-types.ts';

// #413 (Darren, 2026-10-18): any affinity raises and removes barriers. Since #460 raising is
// its own action, `raise_barrier` (Darren, 2026-10-24: separate raise command): with a push it
// raises a line of `range` barrier actors of the caster's kind, each invested with
// 10 × intensity² mana (times the kind's raise scale, #534) that pays 1 a turn; once spent, it erodes 1 durability a turn. A pull
// on a barrier takes it down. The caster walks through its own barriers. Every kind alike.

const KINDS: AffinityKind[] = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'];

function caster(id: string, x: number, y: number, kind: AffinityKind, expression: AffinityExpression,
  stacks = 1, intensity = 1): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y },
    defeatVital: 'health', vitals: { health: { current: 30, max: 30, regen: 0 }, mana: { current: 100, max: 100, regen: 0 },
      stamina: { current: 30, max: 30, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: true, blocksSight: false },
    motivations: [], affinities: [{ kind, expression, stacks, intensity }], activeAffinityKey: `${kind}:${expression}`, holdings: [] } as ActorRecord;
}
const costs = {
  castManaBase: Object.fromEntries(KINDS.flatMap(kind => [[`${kind}:pull`, 1], [`${kind}:push`, 1]])),
  movementStamina: { me: 1, other: 1 },
};
const room = (width: number, height: number, actors: ActorRecord[]) => createActorRegistry({
  dimensions: { width, height }, terrain: Array(width * height).fill('floor'), actors });
function endTurn(turn: ReturnType<typeof createActorTurn>) {
  turn.closeActions(); turn.resolveFields(); turn.regenerate(); turn.resolveExits();
}
const raised = (registry: ReturnType<typeof room>) => registry.snapshot().actors.filter(actor => actor.raisedBy);

test('earth raises barriers with twice the investment and durability; every other kind once (#534)', () => {
  expect(KINDS.filter(kind => affinityTableRow(kind)!.raiseScale !== 1)).toEqual(['earth']);
  expect(affinityTableRow('earth')!.raiseScale).toBe(2);
  expect(raisedBarrierStats(2, 2)).toEqual({ mana: 80, durability: 80 });
});

for (const kind of KINDS) {
  test(`a ${kind} push raised into an empty tile is a ${kind} barrier the caster owns`, () => {
    const registry = room(5, 1, [caster('me', 0, 0, kind, 'push', 2, 2)]);
    const turn = createActorTurn(registry, 0, costs);
    expect(turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 2, y: 0 } } })).toBe(true);
    const [barrier] = raised(registry).filter(actor => actor.position.x === 2);
    expect(barrier).toMatchObject({ raisedBy: 'me', defeatVital: 'durability', lifecycle: 'alive',
      affinities: [{ kind, expression: 'push' }] });
    expect(barrier.capabilities).toMatchObject({ blocksMovement: true, canMove: false, canCast: false });
    // #534: the kind's raise scale multiplies the investment and durability (earth ×2).
    const amount = 40 * affinityTableRow(kind)!.raiseScale;
    expect(barrier.vitals.mana).toEqual({ current: amount, max: amount, regen: 0 });
    expect(barrier.vitals.durability).toEqual({ current: amount, max: amount, regen: 0 });
    // The Allocator's push price: base 1 × intensity 2 × range 2·3/2.
    expect(registry.getActor('me')!.vitals.mana!.current).toBe(100 - 6);
  });

  test(`a ${kind} pull on a barrier takes it down`, () => {
    const registry = room(5, 1, [caster('me', 0, 0, kind, 'push', 2, 1)]);
    const turn = createActorTurn(registry, 0, costs);
    turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 1, y: 0 } } });
    endTurn(turn);
    const remover = caster('other', 3, 0, KINDS[(KINDS.indexOf(kind) + 3) % KINDS.length], 'pull', 2, 1);
    const withRemover = createActorRegistry({ ...registry.snapshot(), actors: [...registry.snapshot().actors, remover] });
    const next = createActorTurn(withRemover, 1, costs);
    const barrier = raised(withRemover)[0];
    expect(next.apply({ actorId: 'other', tick: 1, kind: 'cast_affinity', params: { targetId: barrier.id } })).toBe(true);
    expect(withRemover.getActor(barrier.id)!.lifecycle).toBe('defeated');
  });
}

test('the raised line runs across the cast, centred on the target tile, and stops at walls and actors', () => {
  expect(raisedBarrierCells({ x: 0, y: 2 }, { x: 2, y: 2 }, 3)).toEqual([{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 1 }]);
  expect(raisedBarrierCells({ x: 0, y: 0 }, { x: 1, y: 1 }, 2)).toEqual([{ x: 1, y: 1 }, { x: 0, y: 2 }]);
  const registry = room(5, 5, [caster('me', 0, 2, 'earth', 'push', 3, 1), caster('other', 2, 3, 'fire', 'pull')]);
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 2, y: 2 } } })).toBe(true);
  // The cell below holds an actor, so that side stops and the other side takes the rest.
  expect(raised(registry).map(actor => actor.position)).toEqual([{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
});

test('barrier stats grow with intensity squared', () => {
  expect(raisedBarrierStats(1)).toEqual({ mana: 10, durability: 10 });
  expect(raisedBarrierStats(3)).toEqual({ mana: 90, durability: 90 });
});

test('an invested barrier pays 1 mana a turn, then erodes 1 durability a turn until it is gone', () => {
  const registry = room(3, 1, [caster('me', 0, 0, 'growth', 'push', 1, 1)]);
  let turn = createActorTurn(registry, 0, costs);
  turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 1, y: 0 } } });
  endTurn(turn);
  const id = raised(registry)[0].id;
  expect(registry.getActor(id)!.vitals.mana!.current).toBe(9);
  for (let tick = 1; tick < 10; tick += 1) { turn = createActorTurn(registry, tick, costs); endTurn(turn); }
  expect(registry.getActor(id)!.vitals).toMatchObject({ mana: { current: 0 }, durability: { current: 10 } });
  for (let tick = 10; tick < 19; tick += 1) { turn = createActorTurn(registry, tick, costs); endTurn(turn); }
  expect(registry.getActor(id)!.vitals.durability!.current).toBe(1);
  turn = createActorTurn(registry, 19, costs); endTurn(turn);
  expect(registry.getActor(id)!.lifecycle).toBe('defeated');
});

test('the caster walks through its own barrier; anyone else is blocked', () => {
  const registry = room(4, 1, [caster('me', 0, 0, 'wind', 'push', 1, 1), caster('other', 3, 0, 'water', 'pull')]);
  let turn = createActorTurn(registry, 0, costs);
  turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 1, y: 0 } } });
  turn.apply({ actorId: 'other', tick: 0, kind: 'move', params: { target: { x: 2, y: 0 } } });
  endTurn(turn);
  turn = createActorTurn(registry, 1, costs);
  expect(turn.apply({ actorId: 'me', tick: 1, kind: 'move', params: { target: { x: 1, y: 0 } } })).toBe(true);
  endTurn(turn);
  // The owner standing in its barrier reloads (snapshots round-trip).
  expect(() => createActorRegistry(registry.snapshot())).not.toThrow();
  const blocked = room(4, 1, [caster('me', 0, 0, 'wind', 'push', 1, 1), caster('other', 2, 0, 'water', 'pull')]);
  turn = createActorTurn(blocked, 0, costs);
  turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 1, y: 0 } } });
  endTurn(turn);
  turn = createActorTurn(blocked, 1, costs);
  expect(turn.apply({ actorId: 'other', tick: 1, kind: 'move', params: { target: { x: 1, y: 0 } } })).toBe(false);
  expect(turn.lastRejection()).toBe('ActorCollision');
});

test('observation marks raised barriers as temporary, and open for their owner', () => {
  const registry = room(4, 1, [caster('me', 0, 0, 'dark', 'push', 1, 1), caster('other', 3, 0, 'light', 'pull')]);
  const turn = createActorTurn(registry, 0, costs);
  turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 1, y: 0 } } });
  const observation = readActorRegistryObservation(registry, 0);
  expect(observation.tiles.kinds[0][1]).toBe(RAISED_BARRIER_TILE_KIND);
  expect(scopeActorRegistryObservation(observation, 'me').tiles.kinds[0][1]).toBe(0);
  expect(scopeActorRegistryObservation(observation, 'other').tiles.kinds[0][1]).toBe(RAISED_BARRIER_TILE_KIND);
});

test('a raise is refused out of range, at an occupied tile, and with a pull', () => {
  const registry = room(5, 1, [caster('me', 0, 0, 'fire', 'push', 1, 1), caster('other', 1, 0, 'water', 'pull')]);
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 3, y: 0 } } })).toBe(false);
  expect(turn.lastRejection()).toBe('TargetOutOfRange');
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 1, y: 0 } } })).toBe(false);
  expect(turn.lastRejection()).toBe('InvalidTarget');
  expect(turn.apply({ actorId: 'other', tick: 0, kind: 'raise_barrier', params: { target: { x: 2, y: 0 } } })).toBe(false);
  expect(turn.lastRejection()).toBe('InvalidTarget');
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 0, y: 0 }, targetId: 'other' } } as never)).toBe(false);
});

test('a tile cast at a barrier hits that barrier', () => {
  const registry = room(4, 1, [caster('me', 0, 0, 'corrode', 'push', 1, 1), caster('other', 3, 0, 'fortify', 'pull', 2, 1)]);
  let turn = createActorTurn(registry, 0, costs);
  turn.apply({ actorId: 'me', tick: 0, kind: 'raise_barrier', params: { target: { x: 1, y: 0 } } });
  endTurn(turn);
  turn = createActorTurn(registry, 1, costs);
  expect(turn.apply({ actorId: 'other', tick: 1, kind: 'cast_affinity', params: { target: { x: 1, y: 0 } } })).toBe(true);
  expect(raised(registry)[0].lifecycle).toBe('defeated');
});

test('a push cast at an empty tile raises nothing (#460): raising is its own command', () => {
  for (const kind of KINDS) {
    const registry = room(5, 1, [caster('me', 0, 0, kind, 'push', 2, 1)]);
    const turn = createActorTurn(registry, 0, costs);
    // Since #461 the cast travels and leaves a one-turn field instead (actor-free-aim.test.mts).
    expect(turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { target: { x: 2, y: 0 } } })).toBe(true);
    expect(raised(registry)).toEqual([]);
  }
});

// ## TODO: Test Permutations
// - a raise whose whole line is blocked except the target raises one barrier
// - two raises on the same tile over time get distinct ids
// - an opposite-kind push hits a raised barrier twice as hard
// - a caster without the mana for the price raises nothing and pays nothing
