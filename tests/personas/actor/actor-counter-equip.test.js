import { expect, test } from 'vitest';
import { createActorPersona } from '../../../packages/runtime/src/personas/actor/controller.js';
import { TickPhases } from '../../../packages/runtime/src/personas/_shared/tick-state-machine.mts';
import { createActorRegistry } from '../../../packages/core-ts/src/state/actor-registry.ts';
import { readActorRegistryObservation, scopeActorRegistryObservation } from '../../../packages/core-ts/src/rules/actor-observation.ts';

// #564 (Darren, 2026-11-09): a warden that has read a hostile's affinity swaps to the counter kind
// from its pack when that beats staying. Every kind, the same rule. A warden that can cast at the
// hostile now casts (in-range combat outranks an equip); the swap is for the turn it cannot, here a
// warden holding only a restoring push (never aimed at a hostile, #563). A counter that is itself
// restoring cannot be aimed either, so it is not a swap worth a turn.
const RESTORING = ['growth', 'fortify', 'light'];
const KINDS = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'];
const OPPOSED = { fire: 'water', water: 'fire', earth: 'wind', wind: 'earth', growth: 'decay', decay: 'growth', corrode: 'fortify', fortify: 'corrode', light: 'dark', dark: 'light' };

const record = (id, alignment, x, affinities, motivations) => ({ id, alignment, lifecycle: 'alive', position: { x, y: 0 },
  defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 50, max: 50, regen: 0 } },
  capabilities: { canMove: false, canCast: true, canEquip: true, canTake: true, canExit: false, blocksMovement: false, blocksSight: false },
  motivations, affinities, activeAffinityKey: affinities[0] ? `${affinities[0].kind}:${affinities[0].expression}` : null, holdings: [] });

function decide(read, equipped, pack) {
  const registry = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'], actors: [
    record('warden', 'dungeon', 0, [{ kind: equipped, expression: 'push', stacks: 1 }, { kind: pack, expression: 'push', stacks: 1 }], ['attacking']),
    record('delver', 'external', 1, [{ kind: read, expression: 'push', stacks: 1 }], ['stationary']),
  ] });
  const observation = scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), 'warden');
  const payload = { actorId: 'warden', observation, readings: { delver: [{ kind: read, expression: 'push', intensity: 1 }] } };
  const persona = createActorPersona({ clock: () => 'fixed' });
  persona.advance({ phase: TickPhases.OBSERVE, event: 'observe', payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: 'decide', payload, tick: 0 });
  return persona.advance({ phase: TickPhases.DECIDE, event: 'propose', payload, tick: 0 }).actions;
}

for (const read of KINDS) {
  const counter = OPPOSED[read];
  const swaps = !RESTORING.includes(counter);
  test(`reading ${read}, a warden with only a restoring push ${swaps ? `proposes equipping ${counter}` : `does not swap to ${counter}, which it could not aim`}`, () => {
    const equipped = RESTORING.find((kind) => kind !== counter);
    const actions = decide(read, equipped, counter);
    expect(actions.some((action) => action.kind === 'equip_affinity' && action.params.affinityKey === `${counter}:push`)).toBe(swaps);
  });
}

test('already holding the counter kind, the warden does not swap', () => {
  const actions = decide('fire', 'water', 'earth');
  expect(actions.some((action) => action.kind === 'equip_affinity')).toBe(false);
  expect(actions[0].kind).toBe('cast_affinity');
});

// ## TODO: Test Permutations
