import { expect, test } from 'vitest';
import { createActorPersona } from '../../../packages/runtime/src/personas/actor/controller.js';
import { TickPhases } from '../../../packages/runtime/src/personas/_shared/tick-state-machine.mts';
import { createActorRegistry } from '../../../packages/core-ts/src/state/actor-registry.ts';
import { readActorRegistryObservation, scopeActorRegistryObservation } from '../../../packages/core-ts/src/rules/actor-observation.ts';
import { resolveActorFields } from '../../../packages/core-ts/src/rules/actor-fields.ts';
import { createActorTurn } from '../../../packages/core-ts/src/rules/actor-turn.ts';

function setup({ active = 'corrode:push', canEquip = true, mana = 0, alternatives } = {}) {
  const self = { id: 'self', alignment: 'external', lifecycle: 'alive', position: { x: 0, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: mana, max: 10, regen: 0 } },
    capabilities: { canMove: false, canCast: true, canEquip, canTake: true, canExit: false, blocksMovement: false, blocksSight: false },
    motivations: ['stationary'], affinities: [{ kind: 'corrode', expression: 'push', stacks: 1 },
      ...(alternatives || [{ kind: 'fire', expression: 'draw', stacks: 2 }, { kind: 'water', expression: 'emit', stacks: 3 }])],
    activeAffinityKey: active, holdings: [] };
  const source = { ...self, id: 'source', alignment: 'dungeon', affinities: [{ kind: 'fire', expression: 'emit', stacks: 3 }], activeAffinityKey: 'fire:emit' };
  return createActorRegistry({ dimensions: { width: 2, height: 1 }, terrain: ['floor', 'floor'], actors: [self, source] });
}

function decide(registry, solver = false) {
  const observation = scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), 'self');
  const payload = { actorId: 'self', observation,
    ...(solver ? { initialState: { actors: [{ id: 'self', runtimeDecisioning: true }] },
      runtimeDecisioning: { enabled: true, mode: 'solver', preferred: 'solver', targetAdapter: 'z3' } } : {}) };
  const persona = createActorPersona({ clock: () => 'fixed' });
  persona.advance({ phase: TickPhases.OBSERVE, event: 'observe', payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: 'decide', payload, tick: 0 });
  return persona.advance({ phase: TickPhases.DECIDE, event: 'propose', payload, tick: 0 });
}

test('fire room selects owned draw and emits only an equip action without changing mana', () => {
  const registry = setup(); const before = registry.snapshot();
  const result = decide(registry);
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0]).toMatchObject({ kind: 'equip_affinity', params: { affinityKey: 'fire:draw' } });
  expect(registry.snapshot()).toEqual(before);
  const turn = createActorTurn(registry, 0, { castManaBase: {}, movementStamina: {} });
  expect(turn.apply(result.actions[0])).toBe(true);
  expect(turn.apply({ actorId: 'self', tick: 0, kind: 'wait' })).toBe(false);
  expect(registry.getActor('self').vitals.mana.current).toBe(0);
  resolveActorFields(registry);
  // The source's fire emit at intensity 1 gives 1 × 1² a turn (#340).
  expect(registry.getActor('self').vitals.mana.current).toBe(1);
  expect(decide(registry).actions.some(action => action.kind === 'equip_affinity')).toBe(false);
});

test('water emit is a useful alternative through actual opposition', () => {
  const registry = setup({ alternatives: [{ kind: 'water', expression: 'emit', stacks: 3 }] });
  expect(decide(registry).actions[0]).toMatchObject({ kind: 'equip_affinity', params: { affinityKey: 'water:emit' } });
  registry.equipAffinity('self', 'water:emit'); resolveActorFields(registry);
  expect(registry.getActor('self').vitals.health.current).toBe(10);
});

test('equal field outcomes retain current equipment and canEquip=false excludes switches', () => {
  for (const options of [{ canEquip: false }, { active: 'water:emit', mana: 10 }]) {
    const registry = setup(options);
    expect(decide(registry).actions.some(action => action.kind === 'equip_affinity')).toBe(false);
  }
});

test('solver receives the same equipment candidate and its field evaluation', () => {
  const result = decide(setup(), true);
  const envelope = result.effects.find(effect => effect.kind === 'solver_request').request.problem.data;
  const candidate = envelope.candidateActions.find(entry => entry.action.params?.affinityKey === 'fire:draw');
  expect(candidate).toBeDefined();
  const row = envelope.objectives.actorDecision.candidates.find(row => row.candidateActionId === candidate.id);
  expect(row.rank.slice(4, 6)).toEqual([0, 1]);
});

test('equipment evaluation retains contributions when the source actor is unseen', () => {
  // An opposed pair that does not illuminate (#416), so the emitter stays unseen.
  const snapshot = setup({ active: 'earth:emit', alternatives: [
    { kind: 'wind', expression: 'draw', stacks: 2 }, { kind: 'earth', expression: 'emit', stacks: 8 },
  ] }).snapshot();
  snapshot.dimensions.width = 12; snapshot.terrain = Array(12).fill('floor');
  const source = snapshot.actors.find(actor => actor.id === 'source');
  // Intensity 2 so the field still lands a whole point five tiles out (#283 rounds exposure).
  source.position.x = 5; source.affinities[0] = { kind: 'wind', expression: 'emit', stacks: 8, intensity: 2 };
  source.activeAffinityKey = 'wind:emit';
  const registry = createActorRegistry(snapshot);
  const observed = scopeActorRegistryObservation(readActorRegistryObservation(registry, 0), 'self');
  expect(observed.actors.some(actor => actor.id === 'source')).toBe(false);
  expect(decide(registry).actions[0]).toMatchObject({ kind: 'equip_affinity', params: { affinityKey: 'wind:draw' } });
});

// ## TODO: Test Permutations
function focusedSetup(scenario = 'ready') {
  const snapshot = setup({ mana: 10, alternatives: [{ kind: 'water', expression: 'push', stacks: 3 }] }).snapshot();
  snapshot.dimensions.width = 4; snapshot.terrain = Array(4).fill('floor');
  const self = snapshot.actors.find(actor => actor.id === 'self');
  const source = snapshot.actors.find(actor => actor.id === 'source');
  self.motivations = ['attacking'];
  // #218: an armed actor sees adjacent tiles plus lit cells, so the target two
  // tiles away carries a 1-stack lamp that lights its own cell and the observer's.
  source.affinities = [{ kind: 'light', expression: 'emit', stacks: 1 }]; source.activeAffinityKey = 'light:emit';
  source.position.x = 2;
  if (scenario === 'equal_reach') self.affinities[0].stacks = 3;
  if (scenario === 'cannot_cast') self.capabilities.canCast = false;
  if (scenario === 'allied') source.alignment = self.alignment;
  if (scenario === 'defeated') { source.lifecycle = 'defeated'; source.vitals.health.current = 0; }
  if (scenario === 'stationary') self.motivations = ['stationary'];
  if (scenario === 'absent') snapshot.actors = [self];
  return createActorRegistry(snapshot);
}

test('focused readiness switches to an in-range pair and casts only on a later turn', () => {
  const registry = focusedSetup();
  const action = decide(registry).actions[0];
  expect(action).toMatchObject({ kind: 'equip_affinity', params: { affinityKey: 'water:push' } });
  const costs = { castManaBase: { 'water:push': 1 }, movementStamina: {} };
  const turn = createActorTurn(registry, 0, costs);
  expect(turn.apply(action)).toBe(true);
  expect(registry.getActor('self').vitals.mana.current).toBe(10);
  const next = decide(registry).actions[0];
  expect(next).toMatchObject({ kind: 'cast_affinity', params: { targetId: 'source' } });
  expect(turn.apply(next)).toBe(false);
  expect(createActorTurn(registry, 1, costs).apply({ ...next, tick: 1 })).toBe(true);
  expect(registry.getActor('source').vitals.health.current).toBeLessThan(10);
});

test.each(['equal_reach', 'cannot_cast', 'allied', 'defeated', 'stationary', 'absent'])('%s does not cause a focused-only switch', scenario => {
  const registry = focusedSetup(scenario);
  expect(decide(registry).actions.some(action => action.kind === 'equip_affinity')).toBe(false);
  const request = decide(registry, true).effects.find(effect => effect.kind === 'solver_request');
  expect(request.request.problem.data.candidateActions.some(candidate => candidate.action.kind === 'equip_affinity')).toBe(false);
});

test('solver receives the same focused-readiness equipment alternative', () => {
  const request = decide(focusedSetup(), true).effects.find(effect => effect.kind === 'solver_request');
  expect(request.request.problem.data.candidateActions.some(candidate => candidate.action.kind === 'equip_affinity'
    && candidate.action.params.affinityKey === 'water:push')).toBe(true);
});
