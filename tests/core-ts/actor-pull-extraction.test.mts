import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
import { AFFINITY_TABLE } from '../../packages/core-ts/src/state/affinity-table.ts';
import type { ActorRecord, ActorVitalKind, AffinityKind, TerrainKind } from '../../packages/core-ts/src/state/actor-types.ts';

// #462 (free aim, part 3 of #414; Darren's pull revision, 2026-10-18): a pull aimed with the
// cursor extracts from the first actor on its line. The pulled kind's row in the one affinity
// table decides the vital it draws, and the caster gains only what that vital gave up (the
// steal, #336/#354): a target without it yields nothing. A harmful kind's steal still spills
// into the target's defeat vital, uncredited (#354). A pull at an empty tile or a wall does
// nothing and costs its usual price. Every kind alike.

const VITALS: ActorVitalKind[] = ['health', 'mana', 'stamina', 'durability'];
const PULL_PRICE = 6; // base 1 × intensity 1 × range 3·4/2
const PULL_HIT = 2; // pull base 2 × intensity 1²
const costs = {
  castManaBase: Object.fromEntries(AFFINITY_TABLE.flatMap(({ kind }) => [[`${kind}:pull`, 1], [`${kind}:push`, 1]])),
  movementStamina: { me: 1 },
};

function record(id: string, x: number, kind: AffinityKind, vitals: ActorVitalKind[], defeatVital: 'health' | 'durability'): ActorRecord {
  // Below max everywhere, so a steal has room to land; mana is the caster's purse too.
  const vital = (key: ActorVitalKind) => key === 'mana' ? { current: 100, max: 200, regen: 0 } : { current: 20, max: 40, regen: 0 };
  return { id, alignment: id === 'me' ? 'external' : 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital,
    vitals: Object.fromEntries(vitals.map(key => [key, vital(key)])),
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: true, blocksSight: false },
    motivations: [], affinities: [{ kind, expression: 'pull', stacks: 3, intensity: 1 }], activeAffinityKey: `${kind}:pull`, holdings: [] } as unknown as ActorRecord;
}
// The target's own slot is of another opposed pair, so no receiver rule changes the hit.
const neutral = (kind: AffinityKind) => AFFINITY_TABLE[(AFFINITY_TABLE.findIndex(row => row.kind === kind) + 2) % AFFINITY_TABLE.length].kind;

function pullAt(kind: AffinityKind, target: ActorRecord | null, walls: number[] = []) {
  const terrain: TerrainKind[] = [0, 1, 2, 3].map(x => walls.includes(x) ? 'wall' : 'floor');
  const registry = createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain,
    actors: [record('me', 0, kind, VITALS, 'health'), ...(target ? [target] : [])] });
  const turn = createActorTurn(registry, 0, costs);
  const accepted = turn.apply({ actorId: 'me', tick: 0, kind: 'cast_affinity', params: { target: { x: 2, y: 0 } } });
  const current = (id: string) => Object.fromEntries(VITALS.map(key => [key, registry.getActor(id)?.vitals[key]?.current]));
  return { accepted, me: current('me'), target: target ? current(target.id) : null };
}
const start = (key: ActorVitalKind) => key === 'mana' ? 100 : 20;

for (const { kind, primaryVital, spill } of AFFINITY_TABLE) {
  test(`a ${kind} pull extracts ${primaryVital} from a target that has it, and only that`, () => {
    const { accepted, me, target } = pullAt(kind, record('W', 2, neutral(kind), VITALS, 'health'));
    expect(accepted).toBe(true);
    for (const key of VITALS) {
      const price = key === 'mana' ? PULL_PRICE : 0;
      expect(target![key]).toBe(start(key) - (key === primaryVital ? PULL_HIT : 0));
      expect(me[key]).toBe(start(key) + (key === primaryVital ? PULL_HIT : 0) - price);
    }
  });

  test(`a ${kind} pull gets nothing from a target without ${primaryVital}`, () => {
    // A target lacking the row's vital, defeated by the other one (a trap or resource has no
    // health; a delver may carry no durability).
    const defeatVital = primaryVital === 'health' ? 'durability' : 'health';
    const vitals = VITALS.filter(key => key !== primaryVital);
    const { accepted, me, target } = pullAt(kind, record('W', 2, neutral(kind), vitals, defeatVital));
    expect(accepted).toBe(true);
    for (const key of VITALS) expect(me[key]).toBe(start(key) - (key === 'mana' ? PULL_PRICE : 0));
    // Spill (#354): a harmful kind's steal lands on the defeat vital, uncredited; a restoring kind's does not.
    for (const key of vitals) expect(target![key]).toBe(start(key) - (spill && key === defeatVital ? PULL_HIT : 0));
  });

  test(`a ${kind} pull at an empty tile or a wall does nothing and costs its price`, () => {
    for (const walls of [[], [2]]) {
      const { accepted, me } = pullAt(kind, null, walls);
      expect(accepted).toBe(true);
      for (const key of VITALS) expect(me[key]).toBe(start(key) - (key === 'mana' ? PULL_PRICE : 0));
    }
  });
}

// ## TODO: Test Permutations
// - a pull aimed past a nearer actor extracts from the nearer one
// - a steal is capped at the caster's max: a full caster gains nothing, the target still loses
// - a same-kind draw on the target absorbs the pull into its mana instead
// - higher intensity extracts base × intensity²
