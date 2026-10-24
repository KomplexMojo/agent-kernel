import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { AFFINITY_TABLE } from '../../packages/core-ts/src/state/affinity-table.ts';
import type { ActorRecord, AffinityKind, AffinityExpression } from '../../packages/core-ts/src/state/actor-types.ts';

// #410 (Darren chose A, 2026-10-24): intensity 1 lands 1 and regen 1 cancels it, so the turn
// records, per actor and vital, the hit (fields and others' casts) and the regen apart. A hit
// regen cancels is still shown. Every kind alike.

const KINDS = AFFINITY_TABLE.map(row => row.kind);
function actor(id: string, x: number, kind: AffinityKind, expression: AffinityExpression,
  { regen = 0, intensity = 1 }: { regen?: number; intensity?: number } = {}): ActorRecord {
  const vital = () => ({ current: 20, max: 20, regen });
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: vital(), mana: { current: 100, max: 100, regen }, stamina: vital(), durability: vital() },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: true, blocksSight: false },
    motivations: [], affinities: [{ kind, expression, stacks: 1, intensity }], activeAffinityKey: `${kind}:${expression}`, holdings: [] } as unknown as ActorRecord;
}
const costs = {
  castManaBase: Object.fromEntries(KINDS.flatMap(kind => [[`${kind}:pull`, 1], [`${kind}:push`, 1]])),
  movementStamina: { me: 1, W: 1 },
};
const neutral = (kind: AffinityKind) => KINDS[(KINDS.indexOf(kind) + 2) % KINDS.length];
const room = (actors: ActorRecord[]) => createActorRegistry({ dimensions: { width: 5, height: 1 }, terrain: Array(5).fill('floor'), actors });
function playTurn(registry: ReturnType<typeof room>) {
  const turn = createActorTurn(registry, 0, costs);
  turn.closeActions(); turn.resolveFields(); turn.regenerate();
  return turn.snapshot();
}

for (const row of AFFINITY_TABLE.filter(entry => entry.outward === 'damage')) {
  for (const regen of [0, 1, 2]) {
    test(`a ${row.kind} emit ×1 next to a target with regen ${regen}: hit and regen recorded apart`, () => {
      const registry = room([actor('me', 0, row.kind, 'emit'), actor('W', 1, neutral(row.kind), 'pull', { regen })]);
      const start = registry.getActor('W')!.vitals[row.primaryVital]!.current;
      const snapshot = playTurn(registry);
      const change = snapshot.vitalChanges?.find(entry => entry.actorId === 'W' && entry.vital === row.primaryVital);
      // Intensity 1 lands 1; regen restores up to what it took, the pool being full before.
      expect(change).toEqual({ actorId: 'W', vital: row.primaryVital, hit: -1, regen: Math.min(regen, 1) });
      const current = registry.getActor('W')!.vitals[row.primaryVital]!.current;
      expect(current).toBe(start - 1 + Math.min(regen, 1));
    });
  }
}

test('a cast on another records its hit on the target, not the caster\'s price', () => {
  const registry = room([actor('me', 0, 'decay', 'push'), actor('W', 1, 'fire', 'pull')]);
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { targetId: 'W' } })).toBe(true);
  const changes = turn.snapshot().vitalChanges!;
  expect(changes.some(entry => entry.actorId === 'me')).toBe(false);
  expect(changes.find(entry => entry.actorId === 'W' && entry.vital === 'health')!.hit).toBeLessThan(0);
});

test('a quiet turn records no vital changes', () => {
  expect(playTurn(room([actor('me', 0, 'fire', 'pull')])).vitalChanges).toBeUndefined();
});

// ## TODO: Test Permutations
// - intensity 2 against regen 1 lands net damage every turn
// - a restoring emit on a damaged target records a positive hit
// - a hit that spills into the defeat vital records both vitals
