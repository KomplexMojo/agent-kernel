import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../packages/runtime/src/personas/configurator/controller.js';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { createActorTurn } from '../../packages/core-ts/src/rules/actor-turn.ts';
const configurator = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });
function actor(id, category, patch = {}) {
  return configurator.normalizeActorDefinition({ id, category, position: { x: 0, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 0 },
      mana: { current: 20, max: 20, regen: 0 } },
    capabilities: { blocksMovement: false, canTake: true, canEquip: true }, ...patch }).actor;
}
function setup(actors) {
  return createActorRegistry({ dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'floor'], actors });
}
function costs(actors) {
  return configurator.resolveActorTurnCosts({ movementStamina: Object.fromEntries(actors.map(a => [a.id, 0])) });
}
function finish(turn) {
  expect(turn.closeActions()).toBe(true);
  const fields = turn.resolveFields();
  expect(turn.resolveFields()).toBeNull();
  expect(turn.regenerate()).toBe(true);
  expect(turn.regenerate()).toBe(false);
  return fields;
}
test('authored costs compose with lethal combat, atomic competing claims, equipment and replay', () => {
  const actors = [actor('caster', 'delver', {
    affinities: [{ kind: 'fire', expression: 'push', stacks: 5 }], activeAffinityKey: 'fire:push' }),
  actor('source', 'resource', { position: { x: 1, y: 0 },
    vitals: { health: { current: 4, max: 4, regen: 9 }, durability: { current: 3, max: 3, regen: 9 } },
    capabilities: { blocksMovement: true, canCast: true },
    affinities: [{ kind: 'fire', expression: 'emit', stacks: 8 }], activeAffinityKey: 'fire:emit' }),
  actor('competitor', 'barrier', { position: { x: 2, y: 0 } })];
  const prices = costs(actors); const state = setup(actors);
  const first = createActorTurn(state, 1, prices);
  expect(first.apply({ actorId: 'caster', tick: 1, kind: 'cast_affinity', params: { targetId: 'source' } })).toBe(true);
  expect(state.getActor('caster').vitals.mana.current).toBe(5);
  expect(state.getActor('source')).toMatchObject({ lifecycle: 'defeated', vitals: {
    durability: { current: 0 }, health: { current: 0 } } });
  expect(state.isMovementBlocked({ x: 1, y: 0 })).toBe(false);
  expect(first.apply({ actorId: 'source', tick: 1, kind: 'wait' })).toBe(false);
  expect(finish(first).fields).toEqual([]);
  expect(state.getActor('source').vitals.health.current).toBe(0);
  const second = createActorTurn(state, 2, prices);
  const claim = { tick: 2, kind: 'take', params: { targetId: 'source', holdingId: 'affinity:fire:emit' } };
  expect(second.apply({ ...claim, actorId: 'caster' })).toBe(true);
  const saved = JSON.parse(JSON.stringify({ registry: state.snapshot(), turn: second.snapshot() }));
  const replay = createActorRegistry(saved.registry);
  const replayTurn = createActorTurn(replay, 2, prices, saved.turn);
  for (const [registry, turn] of [[state, second], [replay, replayTurn]]) {
    expect(turn.apply({ ...claim, actorId: 'competitor' })).toBe(false);
    expect(turn.apply({ actorId: 'caster', tick: 2, kind: 'equip_affinity', params: { affinityKey: 'fire:emit' } })).toBe(false);
    expect(registry.getActor('caster').affinities.find(a => a.expression === 'emit').stacks).toBe(1);
    expect(registry.getActor('caster').activeAffinityKey).toBe('fire:push');
    finish(turn);
  }
  expect(replay.snapshot()).toEqual(state.snapshot());
  expect(replayTurn.snapshot()).toEqual(second.snapshot());
  const third = createActorTurn(state, 3, prices);
  expect(third.apply({ actorId: 'caster', tick: 3, kind: 'equip_affinity', params: { affinityKey: 'fire:emit' } })).toBe(true);
  expect(state.getActor('caster').vitals.mana.current).toBe(5);
  expect(finish(third).fields.some(field => field.sourceId === 'caster')).toBe(true);
});
test('one authored inventory can equip fire draw for absorption or water emit for opposition', () => {
  const actors = [actor('fire', 'hazard', { affinities: [{ kind: 'fire', expression: 'emit', stacks: 3 }],
    activeAffinityKey: 'fire:emit' }), actor('receiver', 'delver', {
    vitals: { health: { current: 10, max: 10, regen: 0 }, mana: { current: 0, max: 10, regen: 0 } },
    affinities: [{ kind: 'fire', expression: 'draw', stacks: 2 }, { kind: 'water', expression: 'emit', stacks: 3 }] })];
  const prices = costs(actors);
  for (const key of ['fire:draw', 'water:emit']) {
    const state = setup(actors); const turn = createActorTurn(state, 1, prices);
    expect(turn.apply({ actorId: 'receiver', tick: 1, kind: 'equip_affinity', params: { affinityKey: key } })).toBe(true);
    const result = finish(turn);
    expect(state.getActor('receiver').vitals.health.current).toBe(10);
    expect(state.getActor('receiver').vitals.mana.current).toBe(key === 'fire:draw' ? 3 : 0);
    if (key === 'water:emit') expect(result.fields.filter(field => field.position.x === 0)).toEqual([]);
    expect(state.getActor('receiver').affinities).toEqual(actors[1].affinities);
  }
});
// ## TODO: Test Permutations
// - Repeat through the real runner, CLI/MCP adapters and UI after producer migration.
