import { expect, test } from 'vitest';
import { createCore } from '../../packages/core-ts/src/index.ts';
import { createConfiguratorPersona } from '../../packages/runtime/src/personas/configurator/controller.js';
import { createRuntime } from '../../packages/runtime/src/runner/runtime.js';

test('real Actor decisions advance the unified registry from live observations', async () => {
  const configurator = createConfiguratorPersona({ clock: () => 'fixed' });
  const layout = { width: 6, height: 1, terrain: ['floor', 'floor', 'floor', 'floor', 'floor', 'exit'], exitApproach: { x: 4, y: 0 } };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: 'observation-config', runId: 'observation', createdAt: 'fixed' },
    planRef: { id: 'plan', schema: 'agent-kernel/PlanArtifact', schemaVersion: 1 },
    layout, movementStamina: { walker: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: 'observation-initial', runId: 'observation', createdAt: 'fixed' },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 6, height: 1 }, terrain: layout.terrain,
    actors: [{ id: 'walker', category: 'delver', position: { x: 0, y: 0 },
      vitals: { health: { current: 10, max: 10, regen: 0 } }, motivations: ['exploring'] }],
  });
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 1, simConfig, initialState });
  await runtime.step();
  expect(runtime.getActorSnapshot().actors[0].position).toEqual({ x: 1, y: 0 });
  await runtime.step();
  expect(runtime.getActorSnapshot().actors[0].position).toEqual({ x: 2, y: 0 });
});

// ## TODO: Test Permutations
// - Compare replay snapshots across two fresh runtime instances.
