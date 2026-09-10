import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
const configurator = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });
function input(category = 'warden') {
  return { category, id: 'actor', position: { x: 1, y: 1 }, vitals: {
    health: { current: 10, max: 10, regen: 1 }, durability: { current: 3, max: 3, regen: 0 } },
    motivations: ['patrolling', 'attacking'], affinities: [
      { kind: 'fire', expression: 'emit', stacks: 1 }, { kind: 'fire', expression: 'draw', stacks: 2 }],
    activeAffinityKey: 'fire:draw' };
}
test.each([
  ['delver', 'external', 'health', true, true], ['warden', 'dungeon', 'health', true, true],
  ['hazard', 'dungeon', 'durability', false, false], ['resource', 'dungeon', 'durability', false, false],
  ['barrier', 'dungeon', 'durability', false, true],
])('%s applies editable default properties', (category, alignment, defeatVital, canMove, blocksMovement) => {
  const result = configurator.normalizeActorDefinition(input(category));
  expect(result.presentation).toEqual({ category });
  expect(result.actor).toMatchObject({ alignment, defeatVital, capabilities: { canMove, blocksMovement } });
  expect(result.actor).not.toHaveProperty('category');
  expect(result.actor.motivations).toEqual(['patrolling', 'attacking']);
  expect(result.actor.affinities).toHaveLength(2);
});
test('changing only presentation category preserves fully specified mechanical properties', () => {
  const mechanical = configurator.normalizeActorDefinition(input()).actor;
  for (const category of ['delver', 'warden', 'hazard', 'resource', 'barrier']) {
    expect(configurator.normalizeActorDefinition({ category, ...mechanical }).actor).toEqual(mechanical);
  }
});
test('resources may move and barriers retain authored motivations and equipment capabilities', () => {
  const resource = configurator.normalizeActorDefinition({ ...input('resource'),
    alignment: 'external', defeatVital: 'health', capabilities: { canMove: true, canEquip: true, canTake: true } }).actor;
  expect(resource).toMatchObject({ alignment: 'external', defeatVital: 'health',
    capabilities: { canMove: true, canEquip: true, canTake: true } });
  expect(configurator.normalizeActorDefinition(input('barrier')).actor.motivations).toEqual(['patrolling', 'attacking']);
});
test('rejects malformed inventory, defeat vitals and obsolete fields', () => {
  for (const patch of [{ activeAffinityKey: 'water:emit' }, { defeatVital: 'mana' }, { vitals: {} },
    { role: 'warden' }, { alignment: null }, { motivations: null }, { defeatVital: null }, { capabilities: { canMove: 1 } }, { category: 'unknown' }]) {
    expect(() => configurator.normalizeActorDefinition({ ...input(), ...patch })).toThrow();
  }
  const duplicate = input(); duplicate.affinities.push({ ...duplicate.affinities[0] });
  expect(() => configurator.normalizeActorDefinition(duplicate)).toThrow();
});
test('normalization owns detached state without mutating inputs or preset defaults', () => {
  const request = input(); const baseline = structuredClone(request);
  const result = configurator.normalizeActorDefinition(request); result.actor.affinities[0].stacks = 99;
  result.actor.capabilities.canMove = false;
  expect(request).toEqual(baseline);
  expect(configurator.normalizeActorDefinition(request).actor.affinities[0].stacks).toBe(1);
  expect(configurator.normalizeActorDefinition(request).actor.capabilities.canMove).toBe(true);
});
// ## TODO: Test Permutations
// - Artifact builders and CLI/MCP/UI must normalize through this same controller method.
