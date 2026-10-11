import { test, expect } from 'vitest';
import { orchestrateBuild } from '../../packages/runtime/src/build/orchestrate-build.js';
import { initializeCoreFromArtifacts } from '../../packages/runtime/src/runner/core-setup.mjs';

test('production build preserves a placed resource actor and holdings through the loader', async () => {
  const holdings = [{ id: 'grant', kind: 'vital', claimedBy: null, permanenceMode: 'consumable',
    vitals: [{ key: 'health', delta: 2 }] }];
  const result = await orchestrateBuild({ spec: {
    schema: 'agent-kernel/BuildSpec', schemaVersion: 1,
    meta: { id: 'unified', runId: 'unified', createdAt: '2026-09-12T00:00:00Z', source: 'test' },
    intent: { goal: 'build a common resource actor' }, plan: {}, configurator: { inputs: {
      levelGen: { width: 9, height: 9, seed: 42, shape: { roomCount: 1, roomMinSize: 3, roomMaxSize: 3 } },
      actors: [], movementStamina: { ore: 1 }, resources: [{ id: 'ore',
        vitals: { durability: { current: 8, max: 8, regen: 0 } },
        capabilities: { canMove: true }, motivations: ['exploring'], holdings }],
    } },
  } });
  const { registry, costs, presentation } = initializeCoreFromArtifacts(JSON.parse(JSON.stringify(result)));
  expect(registry.snapshot().actors).toHaveLength(1);
  expect(registry.getActor('ore')).toMatchObject({ capabilities: { canMove: true }, holdings,
    vitals: { durability: { current: 8, max: 8, regen: 0 } } });
  expect(presentation.ore.category).toBe('resource');
  expect(costs.movementStamina.ore).toBe(1);
  expect(Object.hasOwn(result.simConfig.layout.data, 'resources')).toBe(false);
});

test('production build converts a hazard preset into an equipped common actor', async () => {
  const result = await orchestrateBuild({ spec: {
    schema: 'agent-kernel/BuildSpec', schemaVersion: 1,
    meta: { id: 'hazard', runId: 'hazard', createdAt: '2026-09-12T00:00:00Z', source: 'test' },
    intent: { goal: 'build a common hazard actor' }, plan: {}, configurator: { inputs: {
      levelGen: { width: 9, height: 9, seed: 42,
        shape: { roomCount: 1, roomMinSize: 3, roomMaxSize: 3 },
        hazards: [{ id: 'flame', blocking: true,
          affinity: { kind: 'fire', expression: 'emit', stacks: 2 } }] },
      actors: [], movementStamina: {}, resources: [],
    } },
  } });
  const { registry, presentation } = initializeCoreFromArtifacts(JSON.parse(JSON.stringify(result)));
  expect(registry.getActor('flame')).toMatchObject({ alignment: 'dungeon', defeatVital: 'durability',
    capabilities: { canMove: false, blocksMovement: true },
    vitals: { durability: { current: 10, max: 10, regen: 0 } },
    affinities: [{ kind: 'fire', expression: 'emit', stacks: 2 }], activeAffinityKey: 'fire:emit' });
  expect(presentation.flame.category).toBe('hazard');
  expect(Object.hasOwn(result.simConfig.layout.data, 'hazards')).toBe(false);
});

test('production build assembles movement stamina from placed mobile actors when omitted', async () => {
  const result = await orchestrateBuild({ spec: {
    schema: 'agent-kernel/BuildSpec', schemaVersion: 1,
    meta: { id: 'stamina', runId: 'stamina', createdAt: '2026-09-16T00:00:00Z', source: 'test' },
    intent: { goal: 'assemble movement costs from the placed roster' }, plan: {}, configurator: { inputs: {
      levelGen: { width: 9, height: 9, seed: 42, shape: { roomCount: 1, roomMinSize: 3, roomMaxSize: 3 } },
      actors: [], resources: [{ id: 'ore',
        vitals: { durability: { current: 8, max: 8, regen: 0 } },
        capabilities: { canMove: true }, motivations: ['exploring'] }],
    } },
  } });
  const { costs } = initializeCoreFromArtifacts(JSON.parse(JSON.stringify(result)));
  expect(costs.movementStamina).toEqual({ ore: 1 });
});
// ## TODO: Test Permutations
// - Budgeted and hazard-bearing production builds after their owning migrations.
