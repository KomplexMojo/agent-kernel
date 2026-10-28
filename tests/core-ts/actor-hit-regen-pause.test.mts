/**
 * #478 (Darren chose proposal A, 2026-10-28): after another actor's push or pull takes a vital,
 * the target's health, durability and stamina, plus the vital the cast took, regenerate nothing
 * for the turn it landed and the HIT_REGEN_PAUSE_TURNS turns after. Mana otherwise keeps
 * regenerating. Every kind alike. Fields do not pause regen (overwhelm is theirs), so a field
 * never pins an actor at 0 stamina.
 */
import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn, HIT_REGEN_PAUSE_TURNS } from '../../packages/core-ts/src/rules/actor-turn.ts';
import type { ActorAffinityEntry, ActorRecord } from '../../packages/core-ts/src/state/actor-types.ts';

function actor(id: string, x: number, affinities: ActorAffinityEntry[] = []): ActorRecord {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 30, max: 30, regen: 2 }, mana: { current: 50, max: 50, regen: 3 },
      stamina: { current: 10, max: 10, regen: 1 }, durability: { current: 10, max: 10, regen: 1 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities,
    activeAffinityKey: affinities[0] ? `${affinities[0].kind}:${affinities[0].expression}` : null, holdings: [] };
}
const costs = { castManaBase: { 'decay:push': 1, 'dark:push': 1 }, movementStamina: { a: 1, b: 1 } };
function world(kind: 'decay' | 'dark' = 'decay') {
  return createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain: ['floor', 'floor', 'floor', 'floor'],
    actors: [actor('a', 0, [{ kind, expression: 'push', stacks: 3, intensity: 1 }]), actor('b', 2)] });
}
const vital = (registry: ReturnType<typeof world>, id: string, name: 'health' | 'mana' | 'stamina' | 'durability') =>
  registry.getActor(id)!.vitals[name]!.current;
function turn(registry: ReturnType<typeof world>, tick: number, cast = false) {
  const t = createActorTurn(registry, tick, costs);
  if (cast) expect(t.apply({ actorId: 'a', tick, kind: 'cast_affinity', params: { targetId: 'b' } })).toBe(true);
  t.closeActions(); t.resolveFields(); t.regenerate();
  return t.snapshot();
}

test('a hit pauses health, durability and stamina regen for the turn and the 3 after; mana keeps regenerating', () => {
  expect(HIT_REGEN_PAUSE_TURNS).toBe(3);
  const registry = world();
  registry.changeVital('b', 'durability', -4);
  registry.changeVital('b', 'stamina', -4);
  registry.changeVital('b', 'mana', -20);
  turn(registry, 1, true); // decay push i1: 2 health
  expect(vital(registry, 'b', 'health')).toBe(28);
  for (let tick = 2; tick <= 1 + HIT_REGEN_PAUSE_TURNS; tick += 1) turn(registry, tick);
  expect(vital(registry, 'b', 'health')).toBe(28);
  expect(vital(registry, 'b', 'durability')).toBe(6);
  expect(vital(registry, 'b', 'stamina')).toBe(6);
  expect(vital(registry, 'b', 'mana')).toBe(30 + 3 * (1 + HIT_REGEN_PAUSE_TURNS));
  turn(registry, 2 + HIT_REGEN_PAUSE_TURNS);
  expect(vital(registry, 'b', 'health')).toBe(30);
  expect(vital(registry, 'b', 'durability')).toBe(7);
  expect(vital(registry, 'b', 'stamina')).toBe(8); // resting: twice the regen (#407)
});

test('a hit on mana pauses mana too', () => {
  const registry = world('dark');
  turn(registry, 1, true); // dark push i1: 2 mana
  expect(vital(registry, 'b', 'mana')).toBe(48);
  turn(registry, 2);
  expect(vital(registry, 'b', 'mana')).toBe(48);
});

test('a new hit restarts the pause; the caster, who took no hit, regenerates as usual', () => {
  const registry = world();
  turn(registry, 1, true);
  turn(registry, 2);
  turn(registry, 3, true);
  for (let tick = 4; tick <= 3 + HIT_REGEN_PAUSE_TURNS; tick += 1) turn(registry, tick);
  expect(vital(registry, 'b', 'health')).toBe(26);
  turn(registry, 4 + HIT_REGEN_PAUSE_TURNS);
  expect(vital(registry, 'b', 'health')).toBe(28);
  expect(vital(registry, 'a', 'mana')).toBe(50);
});

test('the pause is actor state: it survives a registry snapshot round trip', () => {
  const registry = world();
  turn(registry, 1, true);
  expect(registry.getActor('b')!.regenPaused).toEqual({ health: HIT_REGEN_PAUSE_TURNS, durability: HIT_REGEN_PAUSE_TURNS,
    stamina: HIT_REGEN_PAUSE_TURNS });
  const restored = createActorRegistry(registry.snapshot());
  for (let tick = 2; tick <= 1 + HIT_REGEN_PAUSE_TURNS; tick += 1) turn(restored, tick);
  expect(vital(restored, 'b', 'health')).toBe(28);
  expect(restored.getActor('b')!.regenPaused).toBeUndefined();
  expect(() => createActorRegistry({ ...registry.snapshot(),
    actors: registry.snapshot().actors.map(entry => entry.id === 'b' ? { ...entry, regenPaused: { health: 0 } } : entry) }))
    .toThrow(/regen pause/);
});

test('a field hit does not pause regen: a trap never pins a tired actor', () => {
  const registry = createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain: ['floor', 'floor', 'floor', 'floor'],
    actors: [actor('trap', 0, [{ kind: 'fire', expression: 'emit', stacks: 1, intensity: 1 }]), actor('b', 1)] });
  registry.changeVital('b', 'stamina', -10);
  const durability = vital(registry, 'b', 'durability');
  turn(registry, 1);
  expect(vital(registry, 'b', 'durability')).toBeLessThan(durability + 1);
  expect(registry.getActor('b')!.regenPaused).toBeUndefined();
  expect(vital(registry, 'b', 'stamina')).toBe(2); // resting: twice the regen (#407)
});

// ## TODO: Test Permutations
// - a restoring push on an ally does not pause its regen
// - a hit that a restoring field nets out to zero does not pause
// - an overwhelm doubling on a paused vital stays paused
// - a hazard (durability defeat vital) hit pauses durability
