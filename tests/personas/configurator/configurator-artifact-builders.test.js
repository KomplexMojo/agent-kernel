const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/personas/configurator-artifacts-v1-basic.json'), 'utf8'));

test('production artifact builders emit deterministic unified state and authored action costs', async () => {
  const { createConfiguratorPersona } = await import('../../../packages/runtime/src/personas/configurator/controller.js');
  const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });
  const sim = c.buildSimConfigArtifact(fixture.input.simConfig);
  const initial = c.buildInitialStateArtifact(fixture.input.initialState);
  assert.deepEqual(initial, fixture.expected.initialState);
  assert.deepEqual(sim.layout.data, fixture.input.simConfig.layout);
  assert.equal(sim.actionCosts.castManaBase['fire:push'], 2);
  assert.deepEqual(sim.actionCosts.movementStamina, { actor: 1 });
  assert.deepEqual(c.buildInitialStateArtifact(fixture.input.initialState), initial);
  assert.deepEqual(c.buildSimConfigArtifact(fixture.input.simConfig), sim);
  initial.actors[0].vitals.health.current = 0;
  sim.layout.data.terrain[0] = 'wall';
  assert.equal(fixture.input.initialState.actors[0].vitals.health.current, 10);
  assert.equal(fixture.input.simConfig.layout.terrain[0], 'floor');
});
test('initial-state builder rejects duplicate IDs and obsolete resolved-effects input', async () => {
  const { buildInitialStateArtifact } = await import('../../../packages/runtime/src/personas/configurator/artifact-builders.js');
  const input = fixture.input.initialState;
  assert.throws(() => buildInitialStateArtifact({ ...input, actors: [input.actors[0], input.actors[0]] }), /duplicate actor id/);
  assert.throws(() => buildInitialStateArtifact({ ...input, resolvedEffects: {} }), /resolvedEffects/);
});
test('sim-config builder requires an explicitly authored movement cost map', async () => {
  const { createConfiguratorPersona } = await import('../../../packages/runtime/src/personas/configurator/controller.js');
  const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });
  for (const movementStamina of [undefined, null]) {
    assert.throws(() => c.buildSimConfigArtifact({ ...fixture.input.simConfig, movementStamina }), /movement stamina/);
  }
});
test('sim-config builder strips leftover category storage and still rejects unknown extras', async () => {
  const { createConfiguratorPersona } = await import('../../../packages/runtime/src/personas/configurator/controller.js');
  const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });
  const layout = { ...fixture.input.simConfig.layout, budgetScaffold: true, hazards: [], tiles: ['....'] };
  const sim = c.buildSimConfigArtifact({ ...fixture.input.simConfig, layout });
  assert.equal(Object.hasOwn(sim.layout.data, 'budgetScaffold'), false);
  assert.equal(Object.hasOwn(sim.layout.data, 'hazards'), false);
  assert.equal(Object.hasOwn(sim.layout.data, 'tiles'), false);
  assert.deepEqual(sim.layout.data, fixture.input.simConfig.layout);
  assert.throws(
    () => c.buildSimConfigArtifact({
      ...fixture.input.simConfig,
      layout: { ...layout, extraGeometry: true },
    }),
    /unsupported normalized layout fields: extraGeometry/,
  );
});
// ## TODO: Test Permutations
// - Migrate Director and CLI fresh authoring requests to these same production builders.
