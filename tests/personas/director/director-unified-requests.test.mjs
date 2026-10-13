import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildBuildSpecFromSummary } from '../../../packages/runtime/src/personas/director/buildspec-assembler.js';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';

const createdAt = '2026-09-11T00:00:00Z';
const build = args => buildBuildSpecFromSummary({ createdAt, ...args });
const properties = {
  position: { x: 0, y: 0 }, alignment: 'external', defeatVital: 'health',
  vitals: { health: { current: 8, max: 8, regen: 0 } },
  capabilities: { canMove: true, blocksMovement: false },
  motivations: ['defending', 'exploring'],
  affinities: [{ kind: 'fire', expression: 'emit', stacks: 8 }, { kind: 'fire', expression: 'draw', stacks: 2 }],
  activeAffinityKey: null, holdings: [],
};

describe('Director unified actor requests', () => {
  it('relays each preset and explicit properties without legacy state or mechanical defaults', () => {
    for (const category of ['delver', 'warden', 'hazard', 'resource', 'barrier']) {
      const instance = { id: 'subject', category, ...structuredClone(properties), cost: 200 };
      const result = build({ selections: [{ kind: 'actor', applied: { motivation: 'defending' }, instances: [instance] }] });
      expect(result.ok).toBe(true);
      const request = result.spec.configurator.inputs.actors[0];
      expect(request).toEqual({ id: 'subject', category, ...properties });
      request.capabilities.canMove = false;
      expect(instance.capabilities.canMove).toBe(true);
    }
  });

  it('preserves all summary motivations into the existing Configurator entrypoint', () => {
    const result = build({ summary: { actors: [{ actorType: 'warden', motivation: 'defending',
      motivations: properties.motivations, affinity: 'fire', count: 1, vitals: properties.vitals,
      affinities: properties.affinities, activeAffinityKey: 'fire:draw', alignment: 'external',
      capabilities: properties.capabilities }] } });
    expect(result.ok).toBe(true);
    const request = result.spec.configurator.inputs.actors[0];
    expect(request.motivations).toEqual(properties.motivations);
    expect(request.activeAffinityKey).toBe('fire:draw');
    expect(request.alignment).toBe('external');
    const configured = createConfiguratorPersona({ clock: () => createdAt }).normalizeActorDefinition(request);
    expect(configured.actor.activeAffinityKey).toBe('fire:draw');
    expect(configured.actor.motivations).toEqual(properties.motivations);
  });


  // Drift review (2026-10-13): every Director copy list carried `activeAffinityKey` but
  // dropped the slot fields, so a planned actor lost its authored slots and equips.
  it('relays affinity slots, equipped keys and running stacks on every route', () => {
    const equipment = { affinitySlots: 2, equippedAffinityKeys: ['fire:draw', 'fire:emit'],
      equippedAffinityStacks: { 'fire:emit': 3 }, activeAffinityKey: 'fire:draw' };
    const direct = build({ selections: [{ kind: 'actor', applied: {}, instances: [
      { id: 'subject', category: 'warden', ...structuredClone(properties), ...structuredClone(equipment) },
    ] }] });
    expect(direct.spec.configurator.inputs.actors[0]).toMatchObject(equipment);
    const summary = build({ summary: { actors: [{ actorType: 'warden', motivation: 'defending',
      motivations: properties.motivations, affinity: 'fire', count: 1, vitals: properties.vitals,
      affinities: properties.affinities, capabilities: properties.capabilities, ...structuredClone(equipment) }] } });
    expect(summary.ok).toBe(true);
    const request = summary.spec.configurator.inputs.actors[0];
    expect(request).toMatchObject(equipment);
    const configured = createConfiguratorPersona({ clock: () => createdAt }).normalizeActorDefinition(request);
    expect(configured.actor).toMatchObject(equipment);
  });
  it('does not replace explicit invalid properties with preset defaults', () => {
    const result = build({ selections: [{ kind: 'actor', applied: {}, instances: [
      { id: 'invalid', category: null, position: null, motivations: null, vitals: properties.vitals },
    ] }] });
    expect(result.spec.configurator.inputs.actors[0]).toMatchObject({
      category: null, position: null, motivations: null,
    });
    expect(() => createConfiguratorPersona({ clock: () => createdAt })
      .normalizeActorDefinition(result.spec.configurator.inputs.actors[0])).toThrow();
  });

  it('retains composed motivations and overrides through catalog mapping', () => {
    const catalog = JSON.parse(readFileSync(new URL('../../fixtures/pool/catalog-basic.json', import.meta.url)));
    const result = build({ catalog, summary: { actors: [{ actorType: 'delver', motivation: 'attacking',
      motivations: ['attacking', 'exploring'], affinity: 'fire', count: 1,
      activeAffinityKey: null, capabilities: { canMove: false } }] } });
    expect(result.ok).toBe(true);
    expect(result.spec.configurator.inputs.actors[0]).toMatchObject({ category: 'delver',
      motivations: ['attacking', 'exploring'], activeAffinityKey: null, capabilities: { canMove: false } });
  });
});
// ## TODO: Test Permutations
// - Card-form category requests after the remaining card authoring migration.
