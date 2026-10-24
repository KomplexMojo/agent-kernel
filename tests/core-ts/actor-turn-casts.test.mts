import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorRecord, AffinityKind, AffinityExpression } from '../../packages/core-ts/src/state/actor-types.ts';

// #463 (show the battle; Darren, 2026-10-18): core's turn records every accepted cast, so a
// surface can draw its path and name its result: who cast what, the cells it crossed (the
// struck actor's cell included), whom it struck and what changed. Every kind alike.

const KINDS: AffinityKind[] = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'];
function actor(id: string, x: number, kind: AffinityKind, expression: AffinityExpression): ActorRecord {
  const vital = () => ({ current: 20, max: 40, regen: 0 });
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: vital(), mana: { current: 100, max: 200, regen: 0 }, stamina: vital(), durability: vital() },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: true, blocksSight: false },
    motivations: [], affinities: [{ kind, expression, stacks: 3, intensity: 1 }], activeAffinityKey: `${kind}:${expression}`, holdings: [] } as unknown as ActorRecord;
}
const costs = {
  castManaBase: Object.fromEntries(KINDS.flatMap(kind => [[`${kind}:pull`, 1], [`${kind}:push`, 1]])),
  movementStamina: { me: 1 },
};
const neutral = (kind: AffinityKind) => KINDS[(KINDS.indexOf(kind) + 2) % KINDS.length];
const room = (actors: ActorRecord[]) => createActorRegistry({ dimensions: { width: 5, height: 1 }, terrain: Array(5).fill('floor'), actors });

for (const kind of KINDS) {
  for (const expression of ['push', 'pull'] as const) {
    test(`a ${kind} ${expression} at an actor is recorded with its path, its target and what it changed`, () => {
      const registry = room([actor('me', 0, kind, expression), actor('W', 3, neutral(kind), 'pull')]);
      const turn = createActorTurn(registry, 0, costs);
      expect(turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { targetId: 'W' } })).toBe(true);
      const [cast] = turn.snapshot().casts!;
      expect(cast).toMatchObject({ sourceId: 'me', kind, expression, targetId: 'W',
        path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] });
      expect(cast.changes.some(change => change.actorId === 'W')).toBe(true);
      expect(cast.changes).toContainEqual({ actorId: 'me', vital: 'mana', delta: -6 });
    });
  }

  test(`a ${kind} push at a tile is recorded up to the actor it struck, or its landing cell`, () => {
    const registry = room([actor('me', 0, kind, 'push'), actor('friend', 2, neutral(kind), 'pull')]);
    const turn = createActorTurn(registry, 0, costs);
    expect(turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { target: { x: 3, y: 0 } } })).toBe(true);
    expect(turn.snapshot().casts![0]).toMatchObject({ targetId: 'friend', path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] });
    const empty = room([actor('me', 0, kind, 'push')]);
    const next = createActorTurn(empty, 0, costs);
    next.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { target: { x: 2, y: 0 } } });
    const [cast] = next.snapshot().casts!;
    expect(cast.targetId).toBeUndefined();
    expect(cast.path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  });
}

test('a refused cast, or a turn with no cast, records none', () => {
  const registry = room([actor('me', 0, 'fire', 'push')]);
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { target: { x: 4, y: 0 } } })).toBe(false);
  expect(turn.snapshot().casts).toBeUndefined();
});

// ## TODO: Test Permutations
// - a displacing hit records the path to where the target stood before it was moved
// - two casters in one turn are recorded in the order they acted
// - a self-cast records an empty path and the caster as target
