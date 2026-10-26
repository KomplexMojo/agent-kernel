// #420 — the `soak` trait. A target hit by a soak-trait push, or standing in a soak-trait emit
// field, is soaked for `intensity` turns; each move it makes while soaked costs +1 stamina.
// Stamina still regenerates every tick (#407). A soak field cancels its opposite's field by
// stacks (#290). The kinds come from the table's `trait` column, never a kind name.
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn, STAMINA_REST_REGEN_SCALE } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { SOAK_MOVE_STAMINA } from '../../packages/core-ts/src/rules/actor-cast.ts';
import { AFFINITY_TABLE } from '../../packages/core-ts/src/state/affinity-table.ts';
import { getOppositeAffinityKind } from '../../packages/core-ts/src/state/affinity.ts';
import type { ActorRecord, ActorAffinityEntry, AffinityKind } from '../../packages/core-ts/src/state/actor-types.ts';

const SOAKERS = AFFINITY_TABLE.filter(row => row.trait === 'soak').map(row => row.kind);
const OTHERS = AFFINITY_TABLE.filter(row => row.trait !== 'soak').map(row => row.kind);
const opposite = (kind: AffinityKind) => AFFINITY_TABLE[getOppositeAffinityKind(AFFINITY_TABLE.findIndex(row => row.kind === kind) + 1) - 1].kind;

function actor(id: string, x: number, pairs: ActorAffinityEntry[] = [], extra: Partial<ActorRecord> = {}): ActorRecord {
  return { id, alignment: id === 'caster' ? 'external' : 'dungeon', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 50, max: 50, regen: 0 }, stamina: { current: 100, max: 100, regen: 0 },
      durability: { current: 50, max: 50, regen: 0 }, mana: { current: 200, max: 200, regen: 50 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: pairs,
    activeAffinityKey: pairs.length ? `${pairs[0].kind}:${pairs[0].expression}` : null, holdings: [], ...extra } as ActorRecord;
}

const UPKEEP = Array.from({ length: 11 }, (_, stacks) => (stacks === 0 ? 0 : 2 + stacks));
const board = (actors: ActorRecord[]) =>
  createActorRegistry({ dimensions: { width: 12, height: 1 }, terrain: Array(12).fill('floor'), actors });

function tick(registry: ReturnType<typeof board>, n: number, actions: Array<{ actorId: string; kind: string; params?: object }>,
  castKind?: AffinityKind) {
  const turn = createActorTurn(registry, n, { castManaBase: castKind ? { [`${castKind}:push`]: 1 } : {},
    movementStamina: { target: 2, caster: 2 }, persistentUpkeep: UPKEEP });
  const accepted = actions.map(action => turn.apply({ tick: n, ...action } as never));
  turn.closeActions(); turn.resolveFields(); turn.regenerate(); turn.resolveExits();
  return accepted;
}
const stamina = (registry: ReturnType<typeof board>) => registry.getActor('target')!.vitals.stamina!.current;
const step = (x: number) => ({ actorId: 'target', kind: 'move', params: { target: { x, y: 0 } } });

test('a soak-trait push soaks its target for `intensity` turns; each move costs one more stamina', () => {
  for (const kind of SOAKERS) {
    for (const intensity of [1, 2]) {
      const registry = board([actor('caster', 0, [{ kind, expression: 'push', stacks: 3, intensity }]), actor('target', 2)]);
      tick(registry, 1, [{ actorId: 'caster', kind: 'cast_affinity', params: { targetId: 'target' } }], kind);
      expect(registry.getActor('target')!.soaked, `${kind} ×${intensity}`).toBe(intensity);
      let x = 2 + intensity;
      for (let turn = 0; turn < intensity; turn += 1) {
        const before = stamina(registry);
        x += 1; expect(tick(registry, 2 + turn, [step(x)])).toEqual([true]);
        expect(before - stamina(registry), `${kind} ×${intensity} soaked move ${turn + 1}`).toBe(2 + SOAK_MOVE_STAMINA);
      }
      expect(registry.getActor('target')!.soaked).toBeUndefined();
      const before = stamina(registry);
      x += 1; tick(registry, 10, [step(x)]);
      expect(before - stamina(registry), `${kind}: dry again`).toBe(2);
    }
  }
});

test('stamina still regenerates every tick while soaked (#407)', () => {
  for (const kind of SOAKERS) {
    const target = actor('target', 2); target.vitals.stamina = { current: 20, max: 100, regen: 1 };
    const registry = board([actor('caster', 0, [{ kind, expression: 'push', stacks: 3, intensity: 2 }]), target]);
    tick(registry, 1, [{ actorId: 'caster', kind: 'cast_affinity', params: { targetId: 'target' } }], kind);
    const afterHit = stamina(registry);
    tick(registry, 2, [step(3)]);
    expect(stamina(registry)).toBe(afterHit - (2 + SOAK_MOVE_STAMINA) + 1);
    const resting = stamina(registry);
    tick(registry, 3, []);
    expect(stamina(registry)).toBe(resting + STAMINA_REST_REGEN_SCALE);
  }
});

test('standing in a soak-trait emit keeps the actor soaked; leaving lets it dry after `intensity` turns', () => {
  for (const kind of SOAKERS) {
    const registry = board([actor('source', 0, [{ kind, expression: 'emit', stacks: 3, intensity: 2 }]), actor('target', 1)]);
    tick(registry, 1, []);
    expect(registry.getActor('target')!.soaked, kind).toBe(2);
    tick(registry, 2, []);
    expect(registry.getActor('target')!.soaked, `${kind}: still in the field`).toBe(2);
    expect(registry.getActor('source')!.soaked, `${kind}: never its own source`).toBeUndefined();
    for (const [n, x] of [[3, 2], [4, 3], [5, 4], [6, 5]]) tick(registry, n, [step(x)]);
    expect(registry.getActor('target')!.position.x).toBe(5);
    tick(registry, 7, []); tick(registry, 8, []);
    expect(registry.getActor('target')!.soaked, `${kind}: dry once out of reach`).toBeUndefined();
  }
});

test('a soak field its opposite cancels at equal intensity soaks nobody (#290)', () => {
  for (const kind of SOAKERS) {
    const registry = board([actor('source', 0, [{ kind, expression: 'emit', stacks: 3, intensity: 1 }]),
      actor('target', 1, [{ kind: opposite(kind), expression: 'emit', stacks: 3, intensity: 1 }])]);
    tick(registry, 1, []);
    expect(registry.getActor('target')!.soaked, kind).toBeUndefined();
  }
});

test('kinds without the trait soak nobody', () => {
  for (const kind of OTHERS) {
    const registry = board([actor('caster', 0, [{ kind, expression: 'push', stacks: 3 }]), actor('target', 2)]);
    tick(registry, 1, [{ actorId: 'caster', kind: 'cast_affinity', params: { targetId: 'target' } }], kind);
    expect(registry.getActor('target')!.soaked, kind).toBeUndefined();
    const field = board([actor('source', 0, [{ kind, expression: 'emit', stacks: 3 }]), actor('target', 1)]);
    tick(field, 1, []);
    expect(field.getActor('target')!.soaked, `${kind} emit`).toBeUndefined();
  }
});

test('a soaked actor round-trips through a snapshot, and a bad value is refused', () => {
  const registry = board([actor('target', 1, [], { soaked: 2 })]);
  expect(board(registry.snapshot().actors).getActor('target')!.soaked).toBe(2);
  expect(() => board([actor('target', 1, [], { soaked: 0 })])).toThrow(/soak/);
});

// ## TODO: Test Permutations
// - a same-kind draw that absorbs the push does not soak
// - a soaked diagonal move costs the diagonal price plus one
// - two soak sources keep the longer soak
