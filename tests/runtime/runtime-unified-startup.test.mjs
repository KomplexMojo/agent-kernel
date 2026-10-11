import { expect, test } from 'vitest';
import { createCore } from '../../packages/core-ts/src/index.ts';
import { createConfiguratorPersona } from '../../packages/runtime/src/personas/configurator/controller.js';
import { createRuntime } from '../../packages/runtime/src/runner/runtime.js';

const configurator = createConfiguratorPersona({ clock: () => '2026-09-13T00:00:00.000Z' });

function artifacts() {
  const layout = {
    width: 3,
    height: 2,
    terrain: ['spawn', 'floor', 'wall', 'floor', 'exit', 'wall'],
    spawnApproach: { x: 1, y: 0 },
    exitApproach: { x: 1, y: 1 },
  };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: 'config', runId: 'run', createdAt: '2026-09-13T00:00:00.000Z', producedBy: 'test' },
    planRef: { id: 'plan', schema: 'agent-kernel/PlanArtifact', schemaVersion: 1 },
    layout,
    movementStamina: { delver: 1, barrier: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: 'initial', runId: 'run', createdAt: '2026-09-13T00:00:00.000Z', producedBy: 'test' },
    simConfigRef: { id: 'config', schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: layout.width, height: layout.height },
    terrain: layout.terrain,
    actors: [
      {
        id: 'delver', category: 'delver', position: layout.spawnApproach,
        vitals: { health: { current: 10, max: 10, regen: 0 } }, motivations: ['exploring'],
      },
      {
        id: 'barrier', category: 'barrier', position: { x: 0, y: 1 },
        vitals: { durability: { current: 5, max: 5, regen: 0 } }, motivations: [],
      },
    ],
  });
  return JSON.parse(JSON.stringify({ simConfig, initialState }));
}

test('runtime startup owns one unified registry loaded from normalized artifacts', async () => {
  const core = createCore();
  for (const obsolete of ['configureGrid', 'addActorPlacement', 'applyActorPlacements',
    'armStaticHazardAt', 'placeResourceAt', 'placeAffinityResourceAt']) {
    core[obsolete] = () => { throw new Error(`legacy setup called: ${obsolete}`); };
  }
  const runtime = createRuntime({ core, adapters: {} });
  const input = artifacts();
  await runtime.init({ seed: 7, ...input });

  const snapshot = runtime.getActorSnapshot();
  expect(snapshot).toEqual({
    dimensions: { width: 3, height: 2 },
    terrain: input.simConfig.layout.data.terrain,
    actors: input.initialState.actors,
  });
  expect(runtime.getActorPresentation()).toEqual(input.initialState.presentation);

  input.initialState.actors.find(actor => actor.id === 'delver').vitals.health.current = 0;
  expect(runtime.getActorSnapshot().actors.find(actor => actor.id === 'delver').vitals.health.current).toBe(10);
});

test('runtime rejects an initial state without its referenced simulation config', async () => {
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  const { initialState } = artifacts();
  await expect(runtime.init({ seed: 0, initialState })).rejects.toThrow(/simulation config/i);
});

// ## TODO: Test Permutations
// - Reinitializing the same runtime replaces rather than merges registry state.
// - A presentation-only category change leaves the mechanical startup snapshot unchanged.
