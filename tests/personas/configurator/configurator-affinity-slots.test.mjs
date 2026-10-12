import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';

// Equipped slots (maintainer, 2026-10-12): every actor type has the same affinity
// capabilities; only how many it can equip at once differs. Starting slots:
// delver 3, warden 2, hazard/resource/barrier 1 (the core default, so not written).
const configurator = createConfiguratorPersona({ clock: () => '2026-10-12T00:00:00.000Z' });
function input(category, extra = {}) {
  return { category, id: 'actor', position: { x: 1, y: 1 }, vitals: {
    health: { current: 10, max: 10, regen: 1 }, durability: { current: 3, max: 3, regen: 0 } },
    affinities: [{ kind: 'fire', expression: 'push', stacks: 1 }, { kind: 'light', expression: 'emit', stacks: 1 }],
    activeAffinityKey: 'fire:push', ...extra };
}

test.each([['delver', 3], ['warden', 2]])('a %s starts with %i affinity slots', (category, slots) => {
  expect(configurator.normalizeActorDefinition(input(category)).actor.affinitySlots).toBe(slots);
});

test.each(['hazard', 'resource', 'barrier'])('a %s keeps the one-slot default and gains no slot field', category => {
  expect(configurator.normalizeActorDefinition(input(category)).actor).not.toHaveProperty('affinitySlots');
});

test('an authored slot count and equipped list are kept and checked by core', () => {
  const actor = configurator.normalizeActorDefinition(input('hazard', { affinitySlots: 2,
    equippedAffinityKeys: ['fire:push', 'light:emit'] })).actor;
  expect(actor).toMatchObject({ affinitySlots: 2, equippedAffinityKeys: ['fire:push', 'light:emit'] });
  expect(() => configurator.normalizeActorDefinition(input('warden', { affinitySlots: 7 }))).toThrow();
  expect(() => configurator.normalizeActorDefinition(input('warden', {
    equippedAffinityKeys: ['light:emit', 'fire:push'] }))).toThrow();
});

test('a placed roster keeps each actor its preset slots', () => {
  const roster = configurator.normalizeActorRoster({ dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'],
    actors: [{ ...input('delver'), id: 'd', position: { x: 0, y: 0 } }, { ...input('warden'), id: 'w', position: { x: 2, y: 0 } }] });
  expect(roster.actors.map(actor => [actor.id, actor.affinitySlots])).toEqual([['d', 3], ['w', 2]]);
});

// ## TODO: Test Permutations
// - an authored affinitySlots of 1 on a delver is kept (lowers the preset)
// - a resource authored through mapResources keeps an authored equippedAffinityKeys
// - a mechanical warden record re-authored as a barrier keeps its 2 slots
