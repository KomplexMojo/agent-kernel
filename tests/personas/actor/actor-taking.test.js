import { expect, test } from 'vitest';
import { createActorPersona } from '../../../packages/runtime/src/personas/actor/controller.js';
import { TickPhases } from '../../../packages/runtime/src/personas/_shared/tick-state-machine.mts';
import { createActorRegistry } from '../../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../../packages/core-ts/src/rules/actor-turn.ts';
import { readActorRegistryObservation } from '../../../packages/core-ts/src/rules/actor-observation.ts';

function actor(id, x = 0) {
  return { id, alignment: 'external', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 10, max: 10, regen: 0 } },
    capabilities: { canMove: false, canCast: true, canEquip: true, canTake: true, canExit: false, blocksMovement: false, blocksSight: false },
    motivations: ['attacking'], affinities: [{ kind: 'water', expression: 'push', stacks: 1 }], activeAffinityKey: 'water:push', holdings: [] };
}
function setup() {
  const source = actor('source', 1); source.alignment = 'dungeon';
  source.affinities = [{ kind: 'fire', expression: 'emit', stacks: 8 }, { kind: 'growth', expression: 'draw', stacks: 2 }];
  source.activeAffinityKey = 'fire:emit';
  const registry = createActorRegistry({ dimensions: { width: 4, height: 1 }, terrain: Array(4).fill('floor'),
    actors: [actor('self'), actor('other'), source] });
  registry.changeVital('source', 'health', -10);
  return registry;
}
function decide(observation, id = 'self', solver = false) {
  const payload = { actorId: id, observation,
    ...(solver ? { initialState: { actors: [{ id, runtimeDecisioning: true }] },
      runtimeDecisioning: { enabled: true, mode: 'solver', preferred: 'solver', targetAdapter: 'z3' } } : {}) };
  const persona = createActorPersona({ clock: () => 'fixed' });
  persona.advance({ phase: TickPhases.OBSERVE, event: 'observe', payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: 'decide', payload, tick: 0 });
  return persona.advance({ phase: TickPhases.DECIDE, event: 'propose', payload, tick: 0 });
}
test('taking claims one stack and one turn; competing claims cannot duplicate it', () => {
  const registry = setup(); const observation = readActorRegistryObservation(registry, 0);
  const self = decide(observation).actions;
  expect(self).toHaveLength(1);
  expect(self[0]).toMatchObject({ kind: 'take', params: { targetId: 'source', holdingId: 'affinity:fire:emit' } });
  const competing = decide(observation, 'other').actions[0];
  const turn = createActorTurn(registry, 0, { castManaBase: {}, movementStamina: {} });
  expect(turn.apply(self[0])).toBe(true);
  expect(turn.apply(competing)).toBe(false);
  expect(turn.apply({ actorId: 'self', tick: 0, kind: 'wait' })).toBe(false);
  expect(registry.getActor('self').affinities.find(pair => pair.kind === 'fire')).toEqual({ kind: 'fire', expression: 'emit', stacks: 1 });
  expect(registry.getActor('self').activeAffinityKey).toBe('water:push');
  expect(observation.actors.find(actor => actor.id === 'source').holdings[0].claimedBy).toBe(null);
  expect(decide(readActorRegistryObservation(registry, 1)).actions[0].params.holdingId).toBe('affinity:growth:draw');
});
// #478 surfaced it: two wardens beside one defeated delver, out of each other's sight, both
// proposed its first holding every turn, and the one that resolved second was refused turn after
// turn. A taker refused last turn takes from the other end, so the two split the holdings.
test('a taker refused last turn does not stay in step with the taker that beat it', () => {
  const kinds = ['fire', 'growth', 'light', 'water', 'wind', 'earth', 'decay', 'dark'];
  const snapshot = setup().snapshot();
  Object.assign(snapshot.actors.find(actor => actor.id === 'source'), {
    affinities: kinds.map(kind => ({ kind, expression: 'emit', stacks: 1 })), activeAffinityKey: 'fire:emit', holdings: [] });
  const world = createActorRegistry(snapshot);
  const personas = { self: createActorPersona({ clock: () => 'fixed' }), other: createActorPersona({ clock: () => 'fixed' }) };
  const propose = (id, tick) => {
    const payload = { actorId: id, observation: readActorRegistryObservation(world, tick) };
    personas[id].advance({ phase: TickPhases.OBSERVE, event: 'observe', payload, tick });
    personas[id].advance({ phase: TickPhases.DECIDE, event: 'decide', payload, tick });
    const action = personas[id].advance({ phase: TickPhases.DECIDE, event: 'propose', payload, tick }).actions[0];
    personas[id].advance({ phase: TickPhases.DECIDE, event: 'cooldown', payload, tick });
    return action;
  };
  let streak = 0; let longest = 0; let taken = 0;
  for (let tick = 0; tick < kinds.length && taken < kinds.length; tick += 1) {
    const first = propose('self', tick); const second = propose('other', tick);
    expect(first.kind).toBe('take');
    const turn = createActorTurn(world, tick, { castManaBase: {}, movementStamina: {} });
    expect(turn.apply(first)).toBe(true); taken += 1;
    if (second?.kind === 'take' && turn.apply(second)) { taken += 1; streak = 0; } else streak += 1;
    longest = Math.max(longest, streak);
  }
  expect(longest).toBe(1);
});

test.each(['living_source', 'exited_source', 'distant', 'claimed', 'disabled', 'defeated_receiver'])('%s is not a taking candidate', scenario => {
  const observation = readActorRegistryObservation(setup(), 0);
  const self = observation.actors.find(actor => actor.id === 'self');
  const source = observation.actors.find(actor => actor.id === 'source');
  // A living source that can move keeps its holdings; one that cannot is a resource (#435).
  if (scenario === 'living_source') { source.lifecycle = 'alive'; source.vitals.health.current = 10; source.capabilities.canMove = true; }
  if (scenario === 'exited_source') source.lifecycle = 'exited';
  if (scenario === 'distant') source.position.x = 3;
  if (scenario === 'claimed') source.holdings.forEach(holding => { holding.claimedBy = 'other'; });
  if (scenario === 'disabled') self.capabilities.canTake = false;
  if (scenario === 'defeated_receiver') { self.lifecycle = 'defeated'; self.vitals.health.current = 0; }
  expect(decide(observation).actions.some(action => action.kind === 'take')).toBe(false);
  const request = decide(observation, 'self', true).effects.find(effect => effect.kind === 'solver_request');
  expect((request?.request.problem.data.candidateActions || []).some(candidate => candidate.action.kind === 'take')).toBe(false);
});
test('solver receives distinct holdings and truthful defeated-source metadata', () => {
  const result = decide(readActorRegistryObservation(setup(), 0), 'self', true);
  const envelope = result.effects.find(effect => effect.kind === 'solver_request').request.problem.data;
  const claims = envelope.candidateActions.filter(candidate => candidate.action.kind === 'take');
  expect(claims).toHaveLength(2);
  expect(new Set(claims.map(candidate => candidate.id)).size).toBe(2);
  expect(envelope.visibleActors.find(actor => actor.id === 'source')).toMatchObject({ lifecycle: 'defeated', hostile: false,
    holdings: expect.arrayContaining([expect.objectContaining({ id: 'affinity:fire:emit', claimedBy: null })]) });
});

test('an already-owned pair increases by one through the proposed take', () => {
  const snapshot = setup().snapshot();
  snapshot.actors.find(actor => actor.id === 'self').affinities.push({ kind: 'fire', expression: 'emit', stacks: 4 });
  const registry = createActorRegistry(snapshot);
  const action = decide(readActorRegistryObservation(registry, 0)).actions[0];
  expect(createActorTurn(registry, 0, { castManaBase: {}, movementStamina: {} }).apply(action)).toBe(true);
  expect(registry.getActor('self').affinities.find(pair => pair.kind === 'fire').stacks).toBe(5);
});

test('explicit vital holding retains its authored grant semantics', () => {
  const snapshot = setup().snapshot();
  snapshot.actors.find(actor => actor.id === 'self').vitals.health.current = 6;
  snapshot.actors.find(actor => actor.id === 'source').holdings.push({ id: 'a_health', kind: 'vital',
    claimedBy: null, permanenceMode: 'permanent', vitals: [{ key: 'health', delta: 2 }] });
  const registry = createActorRegistry(snapshot);
  const action = decide(readActorRegistryObservation(registry, 0)).actions[0];
  expect(action.params.holdingId).toBe('a_health');
  expect(createActorTurn(registry, 0, { castManaBase: {}, movementStamina: {} }).apply(action)).toBe(true);
  expect(registry.getActor('self').vitals.health).toEqual({ current: 8, max: 12, regen: 0 });
});

test('an intact resource is open: its authored holdings are proposed without defeating it (#435)', () => {
  const snapshot = setup().snapshot();
  const source = snapshot.actors.find(actor => actor.id === 'source');
  Object.assign(source, { lifecycle: 'alive', holdings: [{ id: 'a_health', kind: 'vital', claimedBy: null,
    permanenceMode: 'consumable', vitals: [{ key: 'health', delta: 2 }] }] });
  source.vitals.health.current = 10;
  source.alignment = 'external'; // not a hostile, so taking is the only thing to do with it
  const registry = createActorRegistry(snapshot);
  const action = decide(readActorRegistryObservation(registry, 0)).actions[0];
  expect(action).toMatchObject({ kind: 'take', params: { targetId: 'source', holdingId: 'a_health' } });
  expect(createActorTurn(registry, 0, { castManaBase: {}, movementStamina: {} }).apply(action)).toBe(true);
  expect(registry.getActor('source').lifecycle).toBe('alive');
});

// ## TODO: Test Permutations
// - a lone taker that was never refused keeps id order on every turn
// - a refused taker beside two sources reverses both
// - three takers: the two refused at the front meet again at the back
// - Permuting source and holding enumeration preserves deterministic claim ordering.
