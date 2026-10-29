import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { AFFINITY_TABLE } from '../../packages/core-ts/src/state/affinity-table.ts';
import type { ActorRecord, AffinityKind, AffinityExpression, TerrainKind } from '../../packages/core-ts/src/state/actor-types.ts';

// #421 (Darren, 2026-10-18; built on #414's one-turn fields, 2026-10-24): where a `spread`-trait
// push lands, its field creeps each turn to a seeded random neighbour that is not a wall, one
// intensity weaker, until it reaches 0. An opposite field at least as strong on that cell puts
// it out. It harms whoever it reaches, friend or foe, and costs no more mana after the cast.
// Which kinds spread is the affinity table's `trait` column, never a kind named here.

const SPREADING = AFFINITY_TABLE.filter(row => row.trait === 'spread').map(row => row.kind);
const OTHERS = AFFINITY_TABLE.filter(row => row.trait !== 'spread').map(row => row.kind);
const OPPOSITE: Record<string, AffinityKind> = { fire: 'water', water: 'fire', earth: 'wind', wind: 'earth',
  growth: 'decay', decay: 'growth', corrode: 'fortify', fortify: 'corrode', light: 'dark', dark: 'light' };

function actor(id: string, x: number, y: number, kind: AffinityKind, expression: AffinityExpression,
  stacks = 2, intensity = 3): ActorRecord {
  const vital = () => ({ current: 20, max: 40, regen: 0 });
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y }, defeatVital: 'health',
    vitals: { health: vital(), mana: { current: 100, max: 200, regen: 0 }, stamina: vital(), durability: vital() },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: true, blocksSight: false },
    motivations: [], affinities: [{ kind, expression, stacks, intensity }], activeAffinityKey: `${kind}:${expression}`, holdings: [] } as unknown as ActorRecord;
}
const costs = {
  castManaBase: Object.fromEntries(AFFINITY_TABLE.flatMap(({ kind }) => [[`${kind}:pull`, 1], [`${kind}:push`, 1]])),
  movementStamina: {},
};
function board(width: number, height: number, walls: [number, number][] = [], actors: ActorRecord[] = []) {
  const terrain: TerrainKind[] = Array.from({ length: width * height }, (_, i) =>
    walls.some(([x, y]) => y * width + x === i) ? 'wall' : 'floor');
  return createActorRegistry({ dimensions: { width, height }, terrain, actors });
}
function endTurn(turn: ReturnType<typeof createActorTurn>) {
  turn.closeActions(); turn.resolveFields(); turn.regenerate(); turn.resolveExits();
}
const embers = (registry: ReturnType<typeof board>) => registry.snapshot().spreadEmbers ?? [];

/** Cast at (2,2) on tick 0, then let `ticks` more ticks pass; the embers seen at each tick's start. */
function burn(kind: AffinityKind, seed: number, ticks: number, registry = board(7, 5, [], [actor('me', 0, 2, kind, 'push')])) {
  let turn = createActorTurn(registry, 0, costs, undefined, { seed });
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { target: { x: 2, y: 2 } } })).toBe(true);
  const seen = [embers(registry)];
  for (let tick = 1; tick <= ticks; tick++) {
    endTurn(turn);
    turn = createActorTurn(registry, tick, costs, undefined, { seed });
    seen.push(embers(registry));
  }
  return { registry, seen };
}

test('the affinity table has a spread kind to test', () => {
  expect(SPREADING.length).toBeGreaterThan(0);
});

for (const kind of SPREADING) {
  test(`a ${kind} push leaves a creeping field where it lands that weakens by one a turn until it is gone`, () => {
    const { seen, registry } = burn(kind, 7, 4);
    expect(seen[0]).toEqual([{ sourceId: 'me', kind, stacks: 2, intensity: 3, position: { x: 2, y: 2 }, fresh: true }]);
    expect(seen.map(list => list.map(ember => ember.intensity))).toEqual([[3], [2], [1], [], []]);
    for (const [at, next] of [[0, 1], [1, 2]] as const) {
      const a = seen[at][0].position; const b = seen[next][0].position;
      expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBe(1);
    }
    // No mana after the cast: the price is the push's alone (base 1 × 3² × 2·3/2).
    expect(registry.getActor('me')!.vitals.mana!.current).toBe(100 - 9 * 3);
  });

  test(`a ${kind} creep is the same for the same seed, and the seed chooses the way`, () => {
    const path = (seed: number) => burn(kind, seed, 2).seen.map(list => list.map(ember => `${ember.position.x},${ember.position.y}`).join());
    expect(path(7)).toEqual(path(7));
    const ways = new Set(Array.from({ length: 12 }, (_, seed) => path(seed)[1]));
    expect(ways.size).toBeGreaterThan(1);
  });

  test(`a ${kind} creep never enters a wall, and dies with nowhere to go`, () => {
    // A pocket: (2,2) with walls all round except the way the cast came in, (1,2).
    const walls: [number, number][] = [[1, 1], [2, 1], [3, 1], [3, 2], [1, 3], [2, 3], [3, 3]];
    for (let seed = 0; seed < 8; seed++) {
      const registry = board(5, 5, walls, [actor('me', 0, 2, kind, 'push')]);
      const { seen } = burn(kind, seed, 2, registry);
      for (const list of seen) for (const ember of list) expect(walls.some(([x, y]) => x === ember.position.x && y === ember.position.y)).toBe(false);
    }
    const sealed = board(3, 3, [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
      [actor('me', 1, 1, kind, 'push')]);
    sealed.leaveSpreadEmber({ sourceId: 'me', kind, stacks: 2, intensity: 3, position: { x: 1, y: 1 } });
    createActorTurn(sealed, 1, costs, undefined, { seed: 1 });
    expect(embers(sealed)).toEqual([]);
  });

  test(`an opposite field at least as strong puts a ${kind} creep out; a weaker one does not`, () => {
    for (const [strength, survives] of [[2, false], [1, true]] as const) {
      // An opposite emitter whose field covers every cell round the landing at full strength.
      const registry = board(7, 5, [], [actor('me', 0, 2, kind, 'push'), actor('wet', 2, 2, OPPOSITE[kind], 'emit', 3, strength)]);
      registry.leaveSpreadEmber({ sourceId: 'me', kind, stacks: 2, intensity: 3, position: { x: 2, y: 2 } });
      createActorTurn(registry, 1, costs, undefined, { seed: 3 });
      expect(embers(registry).length).toBe(survives ? 1 : 0);
    }
  });

  test(`a ${kind} creep harms whoever it reaches, a friend too`, () => {
    // Walls leave one way out of (2,2), east to (3,2), where a friend stands.
    const walls: [number, number][] = [[1, 1], [2, 1], [3, 1], [1, 2], [1, 3], [2, 3], [3, 3]];
    const friend = actor('friend', 3, 2, OTHERS.find(other => other !== OPPOSITE[kind])!, 'pull', 1, 1);
    const registry = board(6, 5, walls, [actor('me', 0, 0, kind, 'push'), friend]);
    registry.leaveSpreadEmber({ sourceId: 'me', kind, stacks: 2, intensity: 3, position: { x: 2, y: 2 } });
    const before = JSON.stringify(registry.getActor('friend')!.vitals);
    const turn = createActorTurn(registry, 1, costs, undefined, { seed: 5 });
    expect(embers(registry)[0].position).toEqual({ x: 3, y: 2 });
    endTurn(turn);
    expect(JSON.stringify(registry.getActor('friend')!.vitals)).not.toBe(before);
  });
}

for (const kind of OTHERS) {
  test(`a ${kind} push has no spread trait and leaves nothing creeping`, () => {
    const { seen } = burn(kind, 7, 1);
    expect(seen).toEqual([[], []]);
  });
}

// ## TODO: Test Permutations
// - a spread push that hits an actor creeps from that actor's cell, and does not hit it twice on landing
// - two creeps from one caster on the same cell harm once, as one slot
// - a creep from a caster defeated meanwhile does nothing
// - a registry restored from a snapshot with spreadEmbers keeps creeping
