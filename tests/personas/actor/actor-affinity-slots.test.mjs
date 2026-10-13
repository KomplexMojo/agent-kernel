import { expect, test } from 'vitest';
import { createActorPersona, normalizeActorCommand } from '../../../packages/runtime/src/personas/actor/controller.js';
import { TickPhases } from '../../../packages/runtime/src/personas/_shared/tick-state-machine.mts';
import { createActorRegistry } from '../../../packages/core-ts/src/state/actor-registry.ts';
import { equippedActorAffinityKeys } from '../../../packages/core-ts/src/state/actor-inventory.ts';
import { readActorRegistryObservation, scopeActorRegistryObservation } from '../../../packages/core-ts/src/rules/actor-observation.ts';
import { createActorTurn } from '../../../packages/core-ts/src/rules/actor-turn.ts';

// Equipped slots (maintainer, 2026-10-12): the Actor proposes unequips, names the
// slot it casts from, and equips into a free slot rather than swapping out
// something it still has a use for. Legality stays core's.

test('commands: unequip, equip with a slot to replace, and cast from a named slot', () => {
  expect(normalizeActorCommand({ kind: 'unequip_affinity', params: { affinityKey: 'fire:push' } }))
    .toEqual({ kind: 'unequip_affinity', params: { affinityKey: 'fire:push' } });
  expect(normalizeActorCommand({ kind: 'equip_affinity', params: { affinityKey: 'fire:push', replaceKey: 'light:emit' } }))
    .toEqual({ kind: 'equip_affinity', params: { affinityKey: 'fire:push', replaceKey: 'light:emit' } });
  expect(normalizeActorCommand({ kind: 'cast_affinity', params: { targetId: 'w', affinityKey: 'water:push' } }))
    .toEqual({ kind: 'cast_affinity', params: { targetId: 'w', affinityKey: 'water:push' } });
  expect(normalizeActorCommand({ kind: 'cast_affinity', params: { targetId: 'w' } }))
    .toEqual({ kind: 'cast_affinity', params: { targetId: 'w' } });
  expect(() => normalizeActorCommand({ kind: 'unequip_affinity', params: {} })).toThrow(/affinityKey/);
  expect(() => normalizeActorCommand({ kind: 'equip_affinity', params: { affinityKey: 'fire:push', replaceKey: 'fire' } }))
    .toThrow(/replaceKey/);
  expect(() => normalizeActorCommand({ kind: 'cast_affinity', params: { targetId: 'w', affinityKey: 7 } })).toThrow(/affinityKey/);
});

function actor(id, x, overrides = {}) {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 0, max: 10, regen: 0 } },
    capabilities: { canMove: false, canCast: true, canEquip: true, canTake: true, canExit: false,
      blocksMovement: false, blocksSight: false }, motivations: ['stationary'], affinities: [],
    activeAffinityKey: null, holdings: [], ...overrides };
}

function decide(registry, id = 'self') {
  const observation = scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), id);
  const payload = { actorId: id, observation };
  const persona = createActorPersona({ clock: () => 'fixed' });
  persona.advance({ phase: TickPhases.OBSERVE, event: 'observe', payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: 'decide', payload, tick: 0 });
  return persona.advance({ phase: TickPhases.DECIDE, event: 'propose', payload, tick: 0 }).actions
    .filter(action => !['emit_log', 'emit_telemetry'].includes(action.kind));
}

test('with a free slot, the actor equips the useful draw alongside what it holds instead of swapping', () => {
  const self = actor('self', 0, { affinitySlots: 2, activeAffinityKey: 'corrode:push', affinities: [
    { kind: 'corrode', expression: 'push', stacks: 1 }, { kind: 'fire', expression: 'draw', stacks: 2 }] });
  const source = actor('source', 1, { alignment: 'dungeon', affinities: [{ kind: 'fire', expression: 'emit', stacks: 3 }],
    activeAffinityKey: 'fire:emit' });
  const registry = createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'], actors: [self, source] });
  const actions = decide(registry);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ kind: 'equip_affinity', params: { affinityKey: 'fire:draw' } });
  expect(actions[0].params).not.toHaveProperty('replaceKey');
  const turn = createActorTurn(registry, 0, { castManaBase: {}, movementStamina: {} });
  expect(turn.apply(actions[0])).toBe(true);
  expect(equippedActorAffinityKeys(registry.getActor('self'))).toEqual(['corrode:push', 'fire:draw']);
});

test('an attacker casts from whichever equipped slot reaches, naming it when it is not the first', () => {
  // The warden carries a lamp so it is seen two tiles away in an unlit level.
  const hostile = actor('w', 2, { alignment: 'dungeon', motivations: ['stationary'],
    affinities: [{ kind: 'light', expression: 'emit', stacks: 2 }], activeAffinityKey: 'light:emit',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 } } });
  const self = actor('self', 0, { motivations: ['attacking'], affinitySlots: 2, activeAffinityKey: 'water:push',
    equippedAffinityKeys: ['water:push', 'fire:push'], vitals: { health: { current: 10, max: 10, regen: 0 },
      mana: { current: 10, max: 10, regen: 0 } },
    affinities: [{ kind: 'water', expression: 'push', stacks: 1 }, { kind: 'fire', expression: 'push', stacks: 2 }] });
  const registry = createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'],
    actors: [self, hostile] });
  const casts = decide(registry).filter(action => action.kind === 'cast_affinity');
  expect(casts).toEqual([expect.objectContaining({ params: { targetId: 'w', affinityKey: 'fire:push' } })]);
});

// #230: a slot run below what is held reaches only that far, and a command may set the level.
test('a running level counts: the stacks command param, and a lowered slot no longer reaches', () => {
  expect(normalizeActorCommand({ kind: 'equip_affinity', params: { affinityKey: 'fire:push', stacks: 1 } }))
    .toEqual({ kind: 'equip_affinity', params: { affinityKey: 'fire:push', stacks: 1 } });
  for (const stacks of [0, 1.5, '2']) {
    expect(() => normalizeActorCommand({ kind: 'equip_affinity', params: { affinityKey: 'fire:push', stacks } }))
      .toThrow(/stacks/);
  }
  const hostile = actor('w', 2, { alignment: 'dungeon', motivations: ['stationary'],
    affinities: [{ kind: 'light', expression: 'emit', stacks: 2 }], activeAffinityKey: 'light:emit',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 } } });
  const self = actor('self', 0, { motivations: ['attacking'], activeAffinityKey: 'fire:push',
    equippedAffinityStacks: { 'fire:push': 1 }, vitals: { health: { current: 10, max: 10, regen: 0 },
      mana: { current: 10, max: 10, regen: 0 } }, affinities: [{ kind: 'fire', expression: 'push', stacks: 2 }] });
  const registry = createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'],
    actors: [self, hostile] });
  expect(decide(registry).filter(action => action.kind === 'cast_affinity')).toEqual([]);
});

// ## TODO: Test Permutations
// - a full-slot actor whose equipped affinities are all still useful proposes no swap
// - a one-slot actor still swaps exactly as before (equip without replaceKey)
// - the first in-range push/pull is cast without naming affinityKey
// - an exhausted lasting slot does not count as equipped benefit when comparing equips
