import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { projectActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
import { readActorRegistryLightByCell } from '../../packages/core-ts/src/rules/actor-observation.ts';
import { getActorAffinityEffect } from '../../packages/core-ts/src/rules/actor-affinity.ts';
import { lineOfSightSteps } from '../../packages/core-ts/src/state/visibility.ts';
import type { ActorRecord, AffinityKind, AffinityExpression, TerrainKind } from '../../packages/core-ts/src/state/actor-types.ts';

// #461 (free aim, part 2 of #414; Darren, 2026-10-18): a push or pull cast at a tile travels the
// line sight uses and stops at the first actor (hit as a cast at it is, friendly fire stays) or a
// wall. A push that meets no actor leaves a one-turn field of its kind and intensity on its path
// and landing cell. The price is the same whether it hits or not. Every kind alike.

const KINDS: AffinityKind[] = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'];

function actor(id: string, x: number, y: number, kind: AffinityKind, expression: AffinityExpression,
  stacks = 3, intensity = 1, alignment = 'external'): ActorRecord {
  // Every vital starts below max, so a restoring kind shows as clearly as a harmful one.
  const vital = () => ({ current: 20, max: 40, regen: 0 });
  return { id, alignment, lifecycle: 'alive', position: { x, y }, defeatVital: 'health',
    vitals: { health: vital(), mana: { current: 100, max: 200, regen: 0 }, stamina: vital(), durability: vital() },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: true, blocksSight: false },
    motivations: [], affinities: [{ kind, expression, stacks, intensity }], activeAffinityKey: `${kind}:${expression}`, holdings: [] } as ActorRecord;
}
const costs = {
  castManaBase: Object.fromEntries(KINDS.flatMap(kind => [[`${kind}:pull`, 1], [`${kind}:push`, 1]])),
  movementStamina: { me: 1, walker: 1 },
};
// A receiver of another opposed pair, so neither same-kind nor opposite receiver rules apply.
const neutral = (kind: AffinityKind) => KINDS[(KINDS.indexOf(kind) + 2) % KINDS.length];
const PUSH_PRICE = 6; // base 1 × intensity 1 × range 3·4/2
function corridor(actors: ActorRecord[], walls: number[] = [], width = 6) {
  const terrain: TerrainKind[] = Array.from({ length: width }, (_, x) => walls.includes(x) ? 'wall' : 'floor');
  return createActorRegistry({ dimensions: { width, height: 1 }, terrain, actors });
}
const cast = (x: number) => ({ actorId: 'me', tick: 0, kind: 'cast_affinity' as const, params: { target: { x, y: 0 } } });
const vitals = (record: ActorRecord | null) => record && Object.fromEntries(['health', 'mana', 'stamina', 'durability']
  .map(key => [key, record.vitals[key as 'health']?.current]));
const trailCells = (registry: ReturnType<typeof corridor>) =>
  (registry.snapshot().castTrails ?? []).flatMap(trail => trail.cells.map(cell => cell.x));

for (const kind of KINDS) {
  test(`a ${kind} push at an empty tile leaves a one-turn ${kind} field on its path, for the push's price`, () => {
    const registry = corridor([actor('me', 0, 0, kind, 'push')]);
    const turn = createActorTurn(registry, 0, costs);
    expect(turn.apply(cast(3))).toBe(true);
    expect(registry.snapshot().castTrails).toEqual([{ sourceId: 'me', kind, stacks: 3, intensity: 1,
      cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] }]);
    expect(projectActorFields(registry).fields.filter(field => field.sourceId === 'me')
      .map(field => [field.kind, field.expression, field.position.x])).toEqual([[kind, 'push', 1], [kind, 'push', 2], [kind, 'push', 3]]);
    expect(registry.getActor('me')!.vitals.mana!.current).toBe(100 - PUSH_PRICE);
    // The next tick begins without it.
    turn.closeActions(); turn.resolveFields(); turn.regenerate(); turn.resolveExits();
    createActorTurn(registry, 1, costs);
    expect(registry.snapshot().castTrails).toBeUndefined();
  });

  test(`whoever steps into a ${kind} push's path that turn takes what the push would have done`, () => {
    // Free aim: the push lands on an empty tile, then the walker steps onto its path.
    const registry = corridor([actor('me', 0, 0, kind, 'push'), actor('walker', 3, 0, neutral(kind), 'pull', 1)]);
    const turn = createActorTurn(registry, 0, costs);
    expect(turn.apply(cast(2))).toBe(true);
    const stepped = turn.apply({ actorId: 'walker', tick: 0, kind: 'move', params: { target: { x: 2, y: 0 } } }); expect(turn.lastRejection()).toBe(null); expect(stepped).toBe(true);
    turn.closeActions(); turn.resolveFields();
    // The same push aimed straight at the walker standing there.
    const aimed = corridor([actor('me', 0, 0, kind, 'push'), actor('walker', 2, 0, neutral(kind), 'pull', 1)]);
    const direct = createActorTurn(aimed, 0, costs);
    expect(direct.apply({ actorId: 'walker', tick: 0, kind: 'wait' })).toBe(true);
    expect(direct.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { targetId: 'walker' } })).toBe(true);
    direct.closeActions(); direct.resolveFields();
    const walked = vitals(registry.getActor('walker'))!;
    expect({ ...walked, stamina: undefined }).toEqual({ ...vitals(aimed.getActor('walker'))!, stamina: undefined });
    const effect = getActorAffinityEffect(kind, 'push');
    const before = 20;
    const moved = effect.vital === 'mana' ? 100 : effect.vital === 'stamina' ? before - 1 : before;
    expect(Math.sign(walked[effect.vital]! - moved)).toBe(effect.operation === 'restore' ? 1 : -1);
  });

  test(`a ${kind} push stops at a wall and lands on the last free cell`, () => {
    const registry = corridor([actor('me', 0, 0, kind, 'push')], [2]);
    const turn = createActorTurn(registry, 0, costs);
    expect(turn.apply(cast(3))).toBe(true);
    expect(trailCells(registry)).toEqual([1]);
    expect(registry.getActor('me')!.vitals.mana!.current).toBe(100 - PUSH_PRICE);
  });

  test(`a ${kind} push hits the first actor on its path, a friendly one too, and goes no further`, () => {
    const friend = actor('friend', 1, 0, neutral(kind), 'pull', 1, 1, 'external');
    const beyond = actor('beyond', 3, 0, neutral(kind), 'pull', 1, 1, 'dungeon');
    const registry = corridor([actor('me', 0, 0, kind, 'push'), friend, beyond]);
    const turn = createActorTurn(registry, 0, costs);
    expect(turn.apply(cast(3))).toBe(true);
    expect(vitals(registry.getActor('friend'))).not.toEqual(vitals(friend));
    expect(vitals(registry.getActor('beyond'))).toEqual(vitals(beyond));
    expect(registry.snapshot().castTrails).toBeUndefined();
    expect(registry.getActor('me')!.vitals.mana!.current).toBe(100 - PUSH_PRICE);
  });

  test(`a ${kind} pull at an empty tile leaves nothing and costs its price; it still hits an actor on its path`, () => {
    const registry = corridor([actor('me', 0, 0, kind, 'pull')]);
    let turn = createActorTurn(registry, 0, costs);
    expect(turn.apply(cast(3))).toBe(true);
    expect(registry.snapshot().castTrails).toBeUndefined();
    expect(registry.getActor('me')!.vitals.mana!.current).toBe(100 - PUSH_PRICE);
    const target = actor('target', 2, 0, neutral(kind), 'push', 1);
    const withTarget = corridor([actor('me', 0, 0, kind, 'pull'), target]);
    turn = createActorTurn(withTarget, 0, costs);
    expect(turn.apply(cast(3))).toBe(true);
    expect(vitals(withTarget.getActor('target'))).not.toEqual(vitals(target));
  });
}

test('a light push lights its path for the turn; a water push does not', () => {
  const lit = corridor([actor('me', 0, 0, 'light', 'push', 3, 2)]);
  createActorTurn(lit, 0, costs).apply(cast(3));
  expect(readActorRegistryLightByCell(lit.snapshot())).toEqual({ '1,0': 2, '2,0': 2, '3,0': 2 });
  const water = corridor([actor('me', 0, 0, 'water', 'push', 3, 2)]);
  createActorTurn(water, 0, costs).apply(cast(3));
  expect(readActorRegistryLightByCell(water.snapshot())).toEqual({});
});

test('a cast at a tile is refused out of range and without the mana, and pays nothing', () => {
  const registry = corridor([actor('me', 0, 0, 'fire', 'push', 2)]);
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply(cast(3))).toBe(false);
  expect(turn.lastRejection()).toBe('TargetOutOfRange');
  const poor = actor('me', 0, 0, 'water', 'push');
  poor.vitals.mana!.current = PUSH_PRICE - 1;
  const broke = corridor([poor]);
  const next = createActorTurn(broke, 0, costs);
  expect(next.apply(cast(2))).toBe(false);
  expect(next.lastRejection()).toBe('InsufficientMana');
  expect(broke.snapshot().castTrails).toBeUndefined();
});

test('the cast path is the line sight uses, and a corner between walls stops it', () => {
  expect(lineOfSightSteps({ x: 0, y: 0 }, { x: 2, y: 1 }).map(step => step.cell)).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  expect(lineOfSightSteps({ x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([{ cell: { x: 1, y: 1 }, corner: [{ x: 1, y: 0 }, { x: 0, y: 1 }] }]);
  const terrain: TerrainKind[] = ['floor', 'wall', 'floor', 'floor'];
  const registry = createActorRegistry({ dimensions: { width: 2, height: 2 }, terrain, actors: [actor('me', 0, 0, 'decay', 'push')] });
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { target: { x: 1, y: 1 } } })).toBe(true);
  expect(registry.snapshot().castTrails).toBeUndefined();
});

test('a cast at the caster\'s own tile is a cast at itself', () => {
  const registry = corridor([actor('me', 0, 0, 'growth', 'push')]);
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply(cast(0))).toBe(true);
  expect(registry.getActor('me')!.vitals.health!.current).toBeGreaterThan(20);
});

// ## TODO: Test Permutations
// - two casters' trails of opposite kinds on one cell cancel like lasting fields
// - a trail from a caster defeated later the same tick does nothing
// - a diagonal cast's trail follows the supercover line through open corners
// - a registry restored from a snapshot with castTrails keeps them until the next tick
