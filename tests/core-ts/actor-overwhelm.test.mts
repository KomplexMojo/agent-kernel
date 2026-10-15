import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { readActorOverwhelms, OVERWHELM_NET_STACKS } from '../../packages/core-ts/src/rules/actor-fields.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

// Overwhelm (#289, maintainer 2026-10-15): one rule for every opposed pair. When an
// emitted affinity from other sources beats its opposite on an actor's tile by 2+
// stacks, the actor's regen of that affinity's vital stops (harmful emit) or doubles
// (restoring emit) for the turn.

const PAIRS = [['fire', 'water'], ['earth', 'wind'], ['life', 'decay'], ['corrode', 'fortify'], ['light', 'dark']] as const;
const HARM: Record<string, string> = { fire: 'durability', water: 'health', earth: 'durability', wind: 'stamina',
  decay: 'health', corrode: 'durability', dark: 'mana' };
const RESTORE: Record<string, string> = { life: 'health', fortify: 'durability', light: 'mana' };

function actor(id: string, x: number, pair?: ActorAffinityEntry): ActorRecord {
  const vital = { current: 5, max: 10, regen: 1 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { ...vital }, mana: { current: 10, max: 10, regen: 1 }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [] };
}
const emit = (kind: string, stacks: number) => ({ kind, expression: 'emit', stacks }) as ActorAffinityEntry;
const registry = (actors: ActorRecord[]) =>
  createActorRegistry({ dimensions: { width: 5, height: 1 }, terrain: Array(5).fill('floor'), actors });

test('every affinity in every opposed pair overwhelms at net 2: harm stops regen of its vital, restore doubles it', () => {
  expect(OVERWHELM_NET_STACKS).toBe(2);
  for (const pair of PAIRS) {
    for (const kind of pair) {
      const overwhelms = readActorOverwhelms(registry([actor('trap', 1, emit(kind, 2)), actor('hero', 2)]));
      const vital = HARM[kind] ?? RESTORE[kind];
      expect(overwhelms, kind).toEqual([{ actorId: 'hero', kind, vital, regenScale: HARM[kind] ? 0 : 2 }]);
    }
  }
});

test('net 1 does not overwhelm, and the opposite on the tile counts against it, the actor own included', () => {
  for (const [a, b] of PAIRS) {
    expect(readActorOverwhelms(registry([actor('trap', 1, emit(a, 1)), actor('hero', 2)])), `${a} x1`).toEqual([]);
    // a x3 from the trap against the hero's own b x1: net 2, overwhelms.
    expect(readActorOverwhelms(registry([actor('trap', 1, emit(a, 3)), actor('hero', 2, emit(b, 1))]))
      .filter(entry => entry.actorId === 'hero').map(entry => entry.kind), `${a} x3 vs own ${b} x1`).toEqual([a]);
    // Against the hero's own b x2 it nets 1: no overwhelm.
    expect(readActorOverwhelms(registry([actor('trap', 1, emit(a, 3)), actor('hero', 2, emit(b, 2))]))
      .filter(entry => entry.actorId === 'hero'), `${a} x3 vs own ${b} x2`).toEqual([]);
  }
});

test("an actor's own emission never overwhelms it", () => {
  for (const [a] of PAIRS) {
    expect(readActorOverwhelms(registry([actor('hero', 2, emit(a, 3))])), a).toEqual([]);
  }
});

test('a turn applies it: decay stops health regen, life doubles it', () => {
  const run = (kind: string) => {
    const state = registry([actor('trap', 1, emit(kind, 2)), actor('hero', 3)]);
    state.regenerate({ hero: Object.fromEntries(readActorOverwhelms(state)
      .filter(entry => entry.actorId === 'hero').map(entry => [entry.vital, entry.regenScale])) });
    return state.getActor('hero')!.vitals.health!.current;
  };
  expect(run('decay')).toBe(5);
  expect(run('life')).toBe(7);
});

// ## TODO: Test Permutations
// - two harmful kinds on one vital (fire + earth on durability): still stopped
// - a stop and a doubling on the same vital: the stop wins
// - a drained (exhausted) trap does not overwhelm
// - out of reach (beyond the emit radius) does not overwhelm
