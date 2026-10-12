import { expect, test } from 'vitest';
import { createCore } from '../../packages/core-ts/src/index.ts';
import { createConfiguratorPersona } from '../../packages/runtime/src/personas/configurator/controller.js';
import { createRuntime } from '../../packages/runtime/src/runner/runtime.js';

const configurator = createConfiguratorPersona({ clock: () => '2026-09-13T00:00:00.000Z' });

function artifacts(slots = {}) {
  const layout = { width: 3, height: 1, terrain: ['floor', 'floor', 'exit'] };
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: 'actions-config', runId: 'actions', createdAt: '2026-09-13T00:00:00.000Z', producedBy: 'test' },
    planRef: { id: 'plan', schema: 'agent-kernel/PlanArtifact', schemaVersion: 1 },
    layout,
    movementStamina: { caster: 1, source: 0 },
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: 'actions-state', runId: 'actions', createdAt: '2026-09-13T00:00:00.000Z', producedBy: 'test' },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: 3, height: 1 }, terrain: layout.terrain,
    actors: [
      {
        id: 'caster', category: 'delver', position: { x: 0, y: 0 },
        vitals: {
          health: { current: 10, max: 10, regen: 0 },
          mana: { current: 10, max: 10, regen: 0 },
          stamina: { current: 10, max: 10, regen: 0 },
        },
        motivations: ['attacking'],
        affinities: [
          { kind: 'fire', expression: 'pull', stacks: 2 },
          { kind: 'fire', expression: 'push', stacks: 2 },
        ],
        activeAffinityKey: 'fire:pull',
        ...slots,
      },
      {
        id: 'source', category: 'resource', position: { x: 1, y: 0 },
        vitals: { durability: { current: 2, max: 2, regen: 0 } },
        motivations: [],
        affinities: [{ kind: 'fire', expression: 'emit', stacks: 8 }],
        activeAffinityKey: null,
      },
    ],
  });
  return JSON.parse(JSON.stringify({ simConfig, initialState }));
}

function scriptedActor(actionFor) {
  return {
    subscribePhases: ['observe', 'decide'],
    state: 'idle',
    view() { return { state: this.state, context: {} }; },
    advance({ event, tick, payload }) {
      this.state = event === 'cooldown' ? 'cooldown' : event === 'propose' ? 'proposing' : event === 'decide' ? 'deciding' : 'observing';
      let action = null;
      if (event === 'propose') {
        action = actionFor(payload.actorId, tick);
      }
      return { state: this.state, context: {}, actions: action ? [action] : [], effects: [], telemetry: null };
    },
  };
}


test('runtime passes unequip and a named cast slot through to core (equipped slots)', async () => {
  const actionFor = (actorId, tick) => {
    if (actorId === 'source') return { actorId, tick, kind: 'wait' };
    if (tick === 1) return { actorId, tick, kind: 'unequip_affinity', params: { affinityKey: 'fire:pull' } };
    if (tick === 2) return { actorId, tick, kind: 'equip_affinity', params: { affinityKey: 'fire:pull', replaceKey: 'fire:push' } };
    if (tick === 3) return { actorId, tick, kind: 'cast_affinity', params: { targetId: 'source', affinityKey: 'fire:pull' } };
    return null;
  };
  const runtime = createRuntime({ core: createCore(), adapters: {}, personas: { actor: scriptedActor(actionFor) } });
  await runtime.init({ seed: 0, ...artifacts({ affinitySlots: 2, equippedAffinityKeys: ['fire:pull', 'fire:push'] }) });
  const caster = () => runtime.getActorSnapshot().actors.find(actor => actor.id === 'caster');
  await runtime.step();
  expect(caster().activeAffinityKey).toBe('fire:push');
  expect(caster()).not.toHaveProperty('equippedAffinityKeys');
  await runtime.step();
  expect(caster().activeAffinityKey).toBe('fire:pull');
  await runtime.step();
  expect(caster().vitals.mana.current).toBeLessThan(10);
  const accepted = runtime.getTickFrames().filter(frame => frame.phaseDetail === 'apply')
    .flatMap(frame => frame.acceptedActions).filter(action => action.actorId === 'caster');
  expect(accepted.map(action => action.kind)).toEqual(['unequip_affinity', 'equip_affinity', 'cast_affinity']);
});

// ## TODO: Test Permutations
// - a cast naming an unequipped slot is refused by core and recorded as AffinityNotEquipped
// - an unequip with extra params is refused before core as unsupported
