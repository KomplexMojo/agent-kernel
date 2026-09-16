import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';

const CLOCK = '2026-09-14T00:00:00.000Z';

export function boxedTerrain(width, height) {
  const terrain = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      terrain.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'wall' : 'floor');
    }
  }
  return terrain;
}

export function buildUnifiedArtifacts({
  width,
  height,
  terrain,
  actors,
  movementStamina,
  runId = 'run_test',
  clock = CLOCK,
  producedBy = 'test',
} = {}) {
  const configurator = createConfiguratorPersona({ clock: () => clock });
  const meta = (id) => ({ id, runId, createdAt: clock, producedBy });
  const exitIndex = terrain.lastIndexOf('exit');
  const layout = { width, height, terrain };
  if (exitIndex >= 0) {
    layout.exitApproach = { x: exitIndex % width, y: Math.floor(exitIndex / width) };
  }
  const mobileIds = actors
    .filter((actor) => actor.category === 'delver' || actor.category === 'warden')
    .map((actor) => actor.id);
  const simConfig = configurator.buildSimConfigArtifact({
    meta: meta('sim_config'),
    planRef: { id: 'plan_test', schema: 'agent-kernel/PlanArtifact', schemaVersion: 1 },
    layout,
    movementStamina: movementStamina ?? Object.fromEntries(mobileIds.map((id) => [id, 0])),
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: meta('initial_state'),
    simConfigRef: {
      id: simConfig.meta.id,
      schema: simConfig.schema,
      schemaVersion: simConfig.schemaVersion,
    },
    dimensions: { width, height },
    terrain,
    actors,
  });
  return { simConfig, initialState };
}

export function unifiedActorRuntimeArtifacts() {
  const configurator = createConfiguratorPersona({ clock: () => '2026-09-14T00:00:00.000Z' });
  const layout = { width: 8, height: 1, terrain: [...Array(7).fill('floor'), 'exit'], exitApproach: { x: 6, y: 0 } };
  const meta = id => ({ id, runId: 'actor-proof', createdAt: '2026-09-14T00:00:00.000Z' });
  const simConfig = configurator.buildSimConfigArtifact({ meta: meta('config'),
    planRef: { id: 'plan', schema: 'agent-kernel/PlanArtifact', schemaVersion: 1 },
    layout, movementStamina: { actor_1: 0 } });
  const initialState = configurator.buildInitialStateArtifact({ meta: meta('initial'),
    simConfigRef: { id: 'config', schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 8, height: 1 }, terrain: layout.terrain,
    actors: [{ id: 'actor_1', category: 'delver', position: { x: 0, y: 0 },
      motivations: ['exploring'], vitals: { health: { current: 10, max: 10, regen: 0 } } }] });
  return { simConfig, initialState };
}
