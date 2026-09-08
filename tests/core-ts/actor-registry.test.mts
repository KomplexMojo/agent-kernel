import { describe, expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord, ActorRegistrySnapshot } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x = 1, blocking = true): ActorRecord {
  return {
    id, alignment: 'dungeon', position: { x, y: 1 }, lifecycle: 'alive',
    defeatVital: 'durability', vitals: { durability: { current: 3, max: 3, regen: 0 } },
    capabilities: { canMove: false, canCast: true, canEquip: false, canTake: false,
      canExit: false, blocksMovement: blocking, blocksSight: false },
    motivations: ['stationary'], affinities: [{ kind: 'fire', expression: 'emit', stacks: 2 }],
    activeAffinityKey: 'fire:emit', holdings: [],
  };
}
function world(actors: ActorRecord[] = []): ActorRegistrySnapshot {
  return { dimensions: { width: 4, height: 3 },
    terrain: ['wall', 'wall', 'wall', 'wall', 'wall', 'spawn', 'exit', 'wall', 'wall', 'floor', 'floor', 'wall'], actors };
}

describe('actor registry', () => {
  test('stable string identity includes prototype-like IDs and ignores insertion order', () => {
    const records = [actor('z', 2), actor('__proto__')];
    const a = createActorRegistry(world(records));
    const b = createActorRegistry(world([...records].reverse()));
    expect(a.getActor('__proto__')?.id).toBe('__proto__');
    expect(a.getActor('missing')).toBeNull();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.snapshot().actors.map(entry => entry.id)).toEqual(['__proto__', 'z']);
  });
  test('one blocker can share a cell with multiple nonblockers', () => {
    const registry = createActorRegistry(world([actor('occupant'), actor('field', 1, false), actor('loot', 1, false)]));
    expect(registry.getActorsAt({ x: 1, y: 1 }).map(a => a.id)).toEqual(['field', 'loot', 'occupant']);
    expect(registry.isMovementBlocked({ x: 1, y: 1 })).toBe(true);
    expect(() => createActorRegistry(world([actor('a'), actor('b')]))).toThrow(/blocking occupancy/);
  });
  test('sight and movement capabilities are independent of alignment or label', () => {
    const screen = actor('screen', 1, false); screen.capabilities.blocksSight = true;
    const registry = createActorRegistry(world([screen]));
    expect(registry.isMovementBlocked(screen.position)).toBe(false);
    expect(registry.isSightBlocked(screen.position)).toBe(true);
    expect(registry.isMovementBlocked({ x: 2, y: 1 })).toBe(false);
    expect(registry.isSightBlocked({ x: 2, y: 1 })).toBe(false);
  });
  test('defeated actors remain discoverable but defeated/exited actors never block', () => {
    const defeated = actor('defeated'); defeated.lifecycle = 'defeated';
    const exited = actor('exited'); exited.lifecycle = 'exited';
    defeated.capabilities.blocksSight = exited.capabilities.blocksSight = true;
    const registry = createActorRegistry(world([defeated, exited]));
    expect(registry.getActorsAt(defeated.position).map(a => a.id)).toEqual(['defeated']);
    expect(registry.isMovementBlocked(defeated.position)).toBe(false);
    expect(registry.isSightBlocked(defeated.position)).toBe(false);
    expect(registry.getActor('exited')?.lifecycle).toBe('exited');
  });
  test('input, query and snapshot mutations cannot alter owned state; JSON restores exactly', () => {
    const input = world([actor('a')]);
    const registry = createActorRegistry(input);
    const baseline = registry.snapshot();
    input.actors[0].affinities[0].stacks = 90; input.terrain[5] = 'wall';
    registry.getActor('a')!.position.x = 2;
    registry.getActorsAt({ x: 1, y: 1 })[0].capabilities.blocksMovement = false;
    const copy = registry.snapshot(); copy.actors[0].holdings.push({
      id: 'loot', kind: 'affinity', affinity: 'fire', expression: 'emit', claimedBy: null,
    });
    expect(registry.snapshot()).toEqual(baseline);
    expect(createActorRegistry(JSON.parse(JSON.stringify(baseline))).snapshot()).toEqual(baseline);
  });
  test.each([{ x: -1, y: 1 }, { x: 4, y: 1 }, { x: 1.5, y: 1 }, { x: NaN, y: 1 }, { x: 0, y: 0 }])(
    'walls and invalid positions block both movement and sight: %j', (point) => {
      const registry = createActorRegistry(world());
      expect(registry.isMovementBlocked(point)).toBe(true);
      expect(registry.isSightBlocked(point)).toBe(true);
      expect(registry.getActorsAt(point)).toEqual([]);
    },
  );
  test('rejects malformed identity and geometry rather than silently dropping actors', () => {
    expect(() => createActorRegistry(world([actor('a'), actor('a', 2)]))).toThrow(/duplicate actor id/);
    expect(() => createActorRegistry(world([actor('')]))).toThrow(/actor id/);
    expect(() => createActorRegistry(world([actor('wall', 0)]))).toThrow(/position/);
    const short = world(); short.terrain.pop();
    expect(() => createActorRegistry(short)).toThrow(/terrain/);
    const invalid = world(); invalid.dimensions.width = 0;
    expect(() => createActorRegistry(invalid)).toThrow(/dimensions/);
    const barrier = world(); (barrier.terrain as string[])[5] = 'barrier';
    expect(() => createActorRegistry(barrier)).toThrow(/terrain/);
  });
  test('refuses presentation leakage and non-JSON state', () => {
    const extra = { ...actor('a'), category: 'hazard' };
    expect(() => createActorRegistry(world([extra]))).toThrow(/actor field/);
    const invalid = actor('a'); invalid.affinities[0].stacks = Infinity;
    expect(() => createActorRegistry(world([invalid]))).toThrow(/JSON/);
    const hidden = world(); Object.defineProperty(hidden, 'toJSON', { value: () => ({}) });
    expect(() => createActorRegistry(hidden)).toThrow(/JSON/);
    const accessor = world(); Object.defineProperty(accessor, 'actors', { get: () => { throw new Error('getter executed'); }, enumerable: true });
    expect(() => createActorRegistry(accessor)).toThrow(/JSON/);
    const cyclic = world(); (cyclic as unknown as { cycle: unknown }).cycle = cyclic;
    expect(() => createActorRegistry(cyclic)).toThrow(/JSON/);
  });
});

// ## TODO: Test Permutations
// - Vital/defeat milestone: require numeric bounds and lifecycle transitions.
// - Equipment/holdings milestones: reject duplicate pairs, missing active keys, repeated claims.
