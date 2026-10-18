import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../packages/runtime/src/personas/configurator/controller.js';
import { initializeCoreFromArtifacts } from '../../packages/runtime/src/runner/core-setup.mjs';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });
function artifacts() {
  const layout = { width: 2, height: 1, terrain: ['floor', 'exit'] };
  const meta = { id: 'config', runId: 'run', producedBy: 'fixture', createdAt: '2026-09-10T00:00:00.000Z' };
  const simConfig = c.buildSimConfigArtifact({ meta, planRef: { id: 'plan', schema: 'unused', schemaVersion: 1 },
    layout, movementStamina: { caster: 1 } });
  const initialState = c.buildInitialStateArtifact({ meta: { ...meta, id: 'initial' },
    simConfigRef: { id: meta.id, schema: simConfig.schema, schemaVersion: simConfig.schemaVersion },
    dimensions: { width: 2, height: 1 }, terrain: layout.terrain, actors: [
      { id: 'caster', category: 'delver', position: { x: 0, y: 0 },
        // Intensity 2 doubles the range-2 cast price (#340): 2 × 9 = 18, all of it.
        vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 18, max: 18, regen: 0 } },
        motivations: ['attacking', 'seeking_resources'],
        affinities: [{ kind: 'fire', expression: 'push', stacks: 2, intensity: 2 }], activeAffinityKey: 'fire:push' },
      { id: 'reward', category: 'resource', position: { x: 1, y: 0 },
        vitals: { durability: { current: 3, max: 3, regen: 0 } },
        // Earth, not fire: a same-kind emitter is immune to a fire push (#348).
        affinities: [{ kind: 'earth', expression: 'emit', stacks: 8 }], activeAffinityKey: 'earth:emit' },
    ] });
  return JSON.parse(JSON.stringify({ simConfig, initialState }));
}
test('production builders serialize into one common loaded registry and executable cast/take actions', () => {
  const inputs = artifacts(); const { registry, costs, presentation } = initializeCoreFromArtifacts(inputs);
  expect(registry.snapshot().actors).toEqual(inputs.initialState.actors);
  expect(presentation.reward.category).toBe('resource');
  expect(registry.getActor('caster').motivations).toEqual(['attacking', 'seeking_resources']);
  const turn = createActorTurn(registry, 1, costs);
  expect(turn.apply({ actorId: 'caster', tick: 1, kind: 'cast_affinity', params: { targetId: 'reward' } })).toBe(true);
  expect(registry.getActor('caster').vitals.mana.current).toBe(0);
  expect(registry.getActor('reward').lifecycle).toBe('defeated');
  turn.closeActions(); expect(turn.resolveFields().fields).toEqual([]); turn.regenerate(); turn.resolveExits();
  const next = createActorTurn(registry, 2, costs);
  expect(next.apply({ actorId: 'caster', tick: 2, kind: 'take', params: { targetId: 'reward', holdingId: 'affinity:earth:emit' } })).toBe(true);
  expect(registry.getActor('caster').affinities.find(a => a.expression === 'emit').stacks).toBe(1);
});
test('loader rejects broken references, split entity state, incomplete presentation and missing prices', () => {
  for (const change of [
    x => { x.initialState.simConfigRef.id = 'other'; },
    x => { x.simConfig.layout.data.hazards = []; },
    x => { delete x.initialState.presentation.reward; },
    x => { delete x.simConfig.actionCosts.movementStamina.caster; },
    x => { delete x.simConfig.actionCosts.castManaBase['fire:push']; },
    x => { x.initialState.actors[0].kind = 'ambulatory'; },
    x => { x.initialState.actors[1].id = 'caster'; },
  ]) {
    const input = artifacts(); change(input);
    expect(() => initializeCoreFromArtifacts(input)).toThrow();
  }
});
test('artifact loading does not pulse fields or share mutable input state', () => {
  const input = artifacts(); const loaded = initializeCoreFromArtifacts(input);
  input.initialState.actors[0].vitals.health.current = 0;
  input.initialState.presentation.caster.category = 'hazard';
  input.simConfig.actionCosts.castManaBase['fire:push'] = 0;
  expect(loaded.registry.getActor('caster').vitals.health.current).toBe(10);
  expect(loaded.presentation.caster.category).toBe('delver');
  expect(loaded.costs.castManaBase['fire:push']).toBe(3);
});
test('the production loader consumes the file-backed valid and invalid actor artifacts', () => {
  const read = name => JSON.parse(readFileSync(new URL(`../fixtures/artifacts/${name}`, import.meta.url), 'utf8'));
  const valid = read('initial-state-artifact-v1-unified.json');
  const simConfig = c.buildSimConfigArtifact({
    meta: { ...valid.meta, id: valid.simConfigRef.id },
    planRef: { id: 'plan', schema: 'unused', schemaVersion: 1 },
    layout: { width: 3, height: 3, terrain: Array(9).fill('floor') }, movementStamina: { actor: 1 },
  });
  expect(initializeCoreFromArtifacts({ simConfig, initialState: valid }).registry.snapshot().actors).toEqual(valid.actors);
  for (const [name, error] of [['active-key', /invalid active affinity key/],
    ['duplicate-pair', /duplicate affinity pair/], ['defeat-vital', /invalid defeat vital/]]) {
    const initialState = read(`invalid/initial-state-artifact-v1-unified-${name}.json`);
    expect(() => initializeCoreFromArtifacts({ simConfig, initialState })).toThrow(error);
  }
});
// ## TODO: Test Permutations
// - Exercise the migrated startup through Moderator, CLI/MCP sessions and browser facade.

// Runs authored before #232 carry five-tier tables; they load on the one curve, with the
// tier-1 price as its base, so core keeps a single cast price model.
test('a legacy artifact with five-tier castMana loads on the curve', () => {
  const input = artifacts(); const { castManaBase, ...rest } = input.simConfig.actionCosts;
  input.simConfig.actionCosts = { ...rest, castMana: Object.fromEntries(Object.entries(castManaBase)
    .map(([key, base]) => [key, [1, 2, 3, 4, 5].map(tier => base * tier)])) };
  const { costs } = initializeCoreFromArtifacts(input);
  expect(costs.castMana).toBeUndefined();
  expect(costs.castManaBase).toEqual(castManaBase);
});
