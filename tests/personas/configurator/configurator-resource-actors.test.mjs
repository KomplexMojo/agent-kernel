import { test, expect } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
const clock = () => '2026-09-12';
const request = () => ({ id: 'ore', position: { x: 1, y: 0 },
  vitals: { durability: { current: 8, max: 8, regen: 0 }, mana: { current: 3, max: 3, regen: 0 } },
  capabilities: { canMove: true, canEquip: true }, motivations: ['exploring', 'defending'],
  affinities: [{ kind: 'fire', expression: 'emit', stacks: 8 }], activeAffinityKey: 'fire:emit',
  holdings: [{ id: 'health-grant', kind: 'vital', permanenceMode: 'consumable', claimedBy: null,
    vitals: [{ key: 'health', delta: 2 }] }] });
function configurator() { const c = createConfiguratorPersona({ clock }); c.provideConfig({}); return c; }
test('resource mapping authors a mobile common actor with explicit holdings', () => {
  const c = configurator(); const input = request(); const [mapped] = c.mapResources([input]);
  expect(mapped).toMatchObject({ ...input, category: 'resource', alignment: 'dungeon', defeatVital: 'durability' });
  const artifact = c.buildInitialStateArtifact({ meta: { id: 'initial' },
    simConfigRef: { id: 'config', schema: 'agent-kernel/SimConfigArtifact', schemaVersion: 1 },
    actors: [mapped], dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'] });
  expect(artifact.actors[0].holdings).toEqual(input.holdings);
  expect(artifact.actors[0].capabilities.canMove).toBe(true);
  mapped.holdings[0].vitals[0].delta = 99;
  expect(input.holdings[0].vitals[0].delta).toBe(2);
});
test('unpositioned requests remain unpositioned and overrides remain explicit', () => {
  const c = configurator(); const input = request(); delete input.position;
  input.alignment = 'external'; input.activeAffinityKey = null;
  const [mapped] = c.mapResources([input]);
  expect(Object.hasOwn(mapped, 'position')).toBe(false);
  expect(mapped.alignment).toBe('external'); expect(mapped.activeAffinityKey).toBe(null);
});
test('resource mapping rejects obsolete shapes and unowned active equipment', () => {
  const c = configurator();
  expect(() => c.mapResources([{ id: 'old', tier: 'common', stat: 'health', delta: 3 }])).toThrow();
  expect(() => c.mapResources([{ ...request(), activeAffinityKey: 'water:draw' }])).toThrow();
  expect(() => c.mapResources([{ ...request(), position: null }])).toThrow();
});
test('resource mapping ignores undefined Director leftovers without accepting V1 loot keys', () => {
  const c = configurator();
  const input = {
    id: 'resource_1',
    permanenceMode: 'consumable',
    vitals: [],
    affinity: { kind: 'water', expression: 'emit', stacks: 2, mana: 50, manaRegen: 5 },
    resourceVitals: undefined,
    permanent: false,
    tier: undefined,
    stat: undefined,
    delta: undefined,
    dropRate: undefined,
    budgetCeiling: undefined,
  };
  const [mapped] = c.mapResources([input]);
  expect(mapped.id).toBe('resource_1');
  expect(mapped.affinities).toEqual([{ kind: 'water', expression: 'emit', stacks: 2 }]);
  expect(Object.hasOwn(mapped, 'permanent')).toBe(false);
  expect(() => c.mapResources([{ ...input, tier: 'common', stat: 'health', delta: 3 }])).toThrow();
});

test('resource mapping converts V3 CLI affinity payloads into pairs and mana without spreading extras', () => {
  const c = configurator();
  const input = {
    id: 'resource_1',
    permanenceMode: 'consumable',
    vitals: [],
    _schemaVersion: 3,
    affinity: { kind: 'water', expression: 'emit', stacks: 2, mana: 50, manaRegen: 5 },
  };
  const [mapped] = c.mapResources([input]);
  expect(mapped).toMatchObject({
    id: 'resource_1',
    category: 'resource',
    defeatVital: 'durability',
    affinities: [{ kind: 'water', expression: 'emit', stacks: 2 }],
    activeAffinityKey: 'water:emit',
    vitals: {
      durability: { current: 1, max: 1, regen: 0 },
      mana: { current: 50, max: 50, regen: 5 },
    },
  });
  expect(Object.hasOwn(mapped, 'affinity')).toBe(false);
  expect(Object.hasOwn(mapped, 'permanenceMode')).toBe(false);
  expect(Object.hasOwn(mapped, '_schemaVersion')).toBe(false);
});

test('resource mapping converts V3 CLI vital grants into holdings without spreading extras', () => {
  const c = configurator();
  const input = {
    id: 'resource_1',
    permanenceMode: 'consumable',
    vitals: [{ key: 'health', delta: 10 }],
    _schemaVersion: 3,
  };
  const [mapped] = c.mapResources([input]);
  expect(mapped).toMatchObject({
    id: 'resource_1',
    category: 'resource',
    defeatVital: 'durability',
    holdings: [{
      id: 'resource_1', kind: 'vital', permanenceMode: 'consumable', claimedBy: null,
      vitals: [{ key: 'health', delta: 10 }],
    }],
  });
  expect(mapped.vitals.durability).toEqual({ current: 1, max: 1, regen: 0 });
  expect(Object.hasOwn(mapped, 'permanenceMode')).toBe(false);
  expect(Object.hasOwn(mapped, '_schemaVersion')).toBe(false);
  expect(Array.isArray(mapped.vitals)).toBe(false);
  input.vitals[0].delta = 99;
  expect(mapped.holdings[0].vitals[0].delta).toBe(10);
});
// ## TODO: Test Permutations
// - Resource CLI parser fixtures after its common request contract migration.

test('placed resource is returned as an actor and builds directly into InitialState', () => {
  const c = configurator(); const input = request(); delete input.position;
  const resources = c.mapResources([input]);
  const layout = { width: 4, height: 1, terrain: ['spawn', 'floor', 'floor', 'exit'] };
  const placed = c.completeObjectPlacement({ layout, resources, hazards: [], actors: [] });
  expect(placed.ok).toBe(true);
  expect(Object.hasOwn(placed.layout, 'resources')).toBe(false);
  expect(placed.actors).toHaveLength(1);
  expect(placed.actors[0].holdings).toEqual(input.holdings);
  expect(placed.actors[0].position).toEqual({ x: 1, y: 0 });
  const initial = c.buildInitialStateArtifact({ meta: { id: 'placed' },
    simConfigRef: { id: 'config', schema: 'agent-kernel/SimConfigArtifact', schemaVersion: 1 },
    actors: placed.actors, dimensions: { width: 4, height: 1 }, terrain: layout.terrain });
  expect(initial.actors[0].affinities).toEqual(input.affinities);
});
