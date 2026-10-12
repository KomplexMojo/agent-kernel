import { expect, test } from 'vitest';
import { createCore } from '../../packages/core-ts/src/index.ts';
import { createConfiguratorPersona } from '../../packages/runtime/src/personas/configurator/controller.js';
import { createRuntime } from '../../packages/runtime/src/runner/runtime.js';

const configurator = createConfiguratorPersona({ clock: () => '2026-09-13T00:00:00.000Z' });

function artifacts() {
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
        // One slot, so the tick-1 equip swaps rather than adding a second slot.
        affinitySlots: 1,
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

test('runtime routes unified actions through one ActorTurn and records replay state', async () => {
  const actionFor = (actorId, tick) => {
    if (actorId === 'source') return { actorId, tick, kind: 'wait' };
    if (tick === 1) return { actorId, tick, kind: 'equip_affinity', params: { affinityKey: 'fire:push' } };
    if (tick === 2) return { actorId, tick, kind: 'cast_affinity', params: { targetId: 'source' } };
    if (tick === 3) return { actorId, tick, kind: 'take', params: { targetId: 'source', holdingId: 'affinity:fire:emit' } };
    if (tick === 4) return { actorId, tick, kind: 'attack', params: { targetId: 'source', damage: 99 } };
    return null;
  };
  const runtime = createRuntime({ core: createCore(), adapters: {}, personas: { actor: scriptedActor(actionFor) } });
  await runtime.init({ seed: 0, ...artifacts() });

  await runtime.step();
  let caster = runtime.getActorSnapshot().actors.find(actor => actor.id === 'caster');
  expect(caster.activeAffinityKey).toBe('fire:push');
  expect(caster.vitals.mana.current).toBe(10);

  await runtime.step();
  expect(runtime.getActorSnapshot().actors.find(actor => actor.id === 'source').lifecycle).toBe('defeated');
  expect(runtime.getActorSnapshot().actors.find(actor => actor.id === 'source').vitals.durability.current).toBe(0);

  await runtime.step();
  caster = runtime.getActorSnapshot().actors.find(actor => actor.id === 'caster');
  expect(caster.affinities.find(pair => pair.kind === 'fire' && pair.expression === 'emit').stacks).toBe(1);
  expect(caster.activeAffinityKey).toBe('fire:push');

  await runtime.step();
  const applyFrames = runtime.getTickFrames().filter(frame => frame.phaseDetail === 'apply');
  expect(applyFrames.flatMap(frame => frame.acceptedActions)
    .every(action => action.schema === 'agent-kernel/Action' && action.schemaVersion === 1)).toBe(true);
  expect(applyFrames.flatMap(frame => frame.acceptedActions).some(action => action.kind === 'attack')).toBe(false);
  expect(applyFrames.at(-1).preCoreRejections).toEqual([
    { action: { actorId: 'caster', tick: 4, kind: 'attack', params: { targetId: 'source', damage: 99 } }, reason: 'unsupported_action_kind' },
  ]);
  for (const frame of applyFrames) {
    expect(frame.emittedSnapshot.view.turn).toMatchObject({ closed: true, fieldsResolved: true, regenerated: true, exitsResolved: true });
    expect(frame.emittedSnapshot.view.registry).toEqual(expect.objectContaining({ dimensions: { width: 3, height: 1 } }));
  }
});

test('runtime movement uses stable IDs and the common exit lifecycle', async () => {
  const actionFor = (actorId, tick) => {
    if (actorId === 'source') return { actorId, tick, kind: 'wait' };
    if (tick === 1) return { actorId, tick, kind: 'move', params: { target: { x: 1, y: 0 } } };
    if (tick === 2) return { actorId, tick, kind: 'move', params: { target: { x: 2, y: 0 } } };
    if (tick === 3) return { actorId, tick, kind: 'wait' };
    return null;
  };
  const runtime = createRuntime({ core: createCore(), adapters: {}, personas: { actor: scriptedActor(actionFor) } });
  await runtime.init({ seed: 0, ...artifacts() });
  await runtime.step();
  await runtime.step();
  await runtime.step();

  const caster = runtime.getActorSnapshot().actors.find(actor => actor.id === 'caster');
  expect(caster.position).toEqual({ x: 2, y: 0 });
  expect(caster.vitals.stamina.current).toBe(8);
  expect(caster.lifecycle).toBe('exited');
  expect(runtime.getTickFrames().filter(frame => frame.phaseDetail === 'apply').at(-1)
    .emittedSnapshot.view.exitedActorIds).toEqual(['caster']);
});

// ## TODO: Test Permutations
// - Two actors contend for one holding in Moderator order; only the first claim succeeds.
// - A failed cast leaves mana unchanged and permits a later valid action in the same turn window.
