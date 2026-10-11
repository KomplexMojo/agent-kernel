import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { projectActorFieldsAt, previewActorFieldChanges, actorFieldExposureAmount, projectActorFields, resolveActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
import { cancelAffinityOverlap } from '../../packages/core-ts/src/state/affinity-spatial.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';
function actor(id: string, x: number, pair?: ActorAffinityEntry): ActorRecord {
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 },
    defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 0 },
      mana: { current: 0, max: 10, regen: 0 } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities: pair ? [pair] : [],
    activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [] };
}
function registry(actors: ActorRecord[]) {
  return createActorRegistry({ dimensions: { width: 5, height: 1 }, terrain: Array(5).fill('floor'), actors });
}
const fire = { kind: 'fire', expression: 'emit', stacks: 3 } as const;
test('equipment alternatives reproject fire absorption and water opposition without a pulse', () => {
  const source = actor('source', 0, fire);
  const receiver = actor('receiver', 0);
  receiver.affinities = [{ kind: 'fire', expression: 'draw', stacks: 2 }, { kind: 'water', expression: 'emit', stacks: 3 }];
  const before = structuredClone([source, receiver]);
  for (const activeAffinityKey of ['fire:draw', 'water:emit'] as const) {
    const alternative = { ...receiver, activeAffinityKey };
    const actors = [source, alternative];
    const fields = projectActorFieldsAt(actors, alternative.position);
    const forecast = previewActorFieldChanges(alternative, fields);
    expect(forecast).toEqual(activeAffinityKey === 'fire:draw'
      ? [{ actorId: receiver.id, vital: 'mana', delta: 3 }] : []);
    if (activeAffinityKey === 'water:emit') expect(fields).toEqual([]);
    expect(fields).toEqual(projectActorFields(registry(actors)).fields.filter(field => field.position.x === 0));
    expect(projectActorFieldsAt([...actors].reverse(), alternative.position)).toEqual(fields);
    if (fields.length) fields[0].position.x = 4;
  }
  expect([source, receiver]).toEqual(before);
});
test('receiver forecast uses durability overflow without mutating the observation', () => {
  const receiver = actor('receiver', 0);
  receiver.vitals.durability = { current: 3, max: 3, regen: 0 };
  const before = structuredClone(receiver);
  const fields = [{ ...fire, stacks: 5, sourceId: 'source', position: receiver.position, intensity: 1 }];
  expect(previewActorFieldChanges(receiver, fields)).toEqual([
    { actorId: receiver.id, vital: 'durability', delta: -3 },
    { actorId: receiver.id, vital: 'health', delta: -2 },
  ]);
  expect(receiver).toEqual(before);
});
test('receiver forecast caps matching draw mana and stops effects at defeat', () => {
  const receiver = actor('receiver', 0, { kind: 'fire', expression: 'draw', stacks: 2 });
  receiver.vitals.mana!.current = 9;
  const field = { ...fire, sourceId: 'source', position: receiver.position, intensity: 1 };
  expect(previewActorFieldChanges(receiver, [field])).toEqual([{ actorId: receiver.id, vital: 'mana', delta: 1 }]);
  receiver.activeAffinityKey = null; receiver.vitals.health!.current = 1;
  expect(previewActorFieldChanges(receiver, [field, { ...field, sourceId: 'z_healer', kind: 'life' }]))
    .toEqual([{ actorId: receiver.id, vital: 'health', delta: -1 }]);
});
test('receiver forecast agrees with a real field pass for all area affinities with one receiver', () => {
  const kinds = ['fire', 'water', 'earth', 'wind', 'life', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;
  for (const kind of kinds) for (const expression of ['emit', 'draw'] as const) {
    const receiver = actor('receiver', 0);
    receiver.vitals = {
      health: { current: 5, max: 10, regen: 0 }, durability: { current: 2, max: 5, regen: 0 },
      mana: { current: 2, max: 5, regen: 0 }, stamina: { current: 2, max: 5, regen: 0 },
    };
    const state = registry([actor('source', 0, { kind, expression, stacks: 3 }), receiver]);
    const cells = projectActorFields(state).fields.filter(cell => cell.position.x === 0);
    const predicted = previewActorFieldChanges(receiver, cells);
    const actual = resolveActorFields(state).changes.filter(change => change.actorId === receiver.id);
    expect(predicted, `${kind}:${expression}`).toEqual(actual);
  }
});
test('forecast cannot credit the same source twice or invent a missing vital', () => {
  const receiver = actor('receiver', 0, { kind: 'fire', expression: 'draw', stacks: 1 });
  const field = { ...fire, sourceId: 'source', position: receiver.position, intensity: 1 };
  expect(previewActorFieldChanges(receiver, [field, field])).toEqual([{ actorId: receiver.id, vital: 'mana', delta: 3 }]);
  delete receiver.vitals.mana;
  expect(previewActorFieldChanges(receiver, [field])).toEqual([]);
});
test('forecast preserves stable source order independently of field enumeration', () => {
  const receiver = actor('receiver', 0);
  receiver.vitals.health!.current = 1;
  const fireCell = { ...fire, sourceId: 'a_fire', position: receiver.position, intensity: 1 };
  const healingCell = { ...fireCell, sourceId: 'z_healer', kind: 'life' as const };
  expect(previewActorFieldChanges(receiver, [healingCell, fireCell]))
    .toEqual([{ actorId: receiver.id, vital: 'health', delta: -1 }]);
});
test('field exposure reads active equipment only and never exposes self or terminal receivers', () => {
  const cell = { ...fire, sourceId: 'source', position: { x: 0, y: 0 }, intensity: 1 };
  const receiver = actor('receiver', 0);
  receiver.affinities = [{ kind: 'fire', expression: 'emit', stacks: 8 }];
  expect(actorFieldExposureAmount(receiver, cell, [cell])).toBe(3);
  receiver.activeAffinityKey = 'fire:emit';
  expect(actorFieldExposureAmount(receiver, cell, [cell])).toBe(0);
  expect(actorFieldExposureAmount(actor('source', 0), cell, [cell])).toBe(0);
  receiver.activeAffinityKey = null; receiver.lifecycle = 'defeated';
  expect(actorFieldExposureAmount(receiver, cell, [cell])).toBe(0);
});

test('projection and receiver evaluation agree across every active affinity pair', () => {
  const kinds = ['fire', 'water', 'earth', 'wind', 'life', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;
  for (const kind of kinds) for (const expression of ['push', 'pull', 'emit', 'draw'] as const) {
    const receiver = actor('receiver', 0, { kind, expression, stacks: 1 });
    const state = registry([actor('source', 0, fire), receiver]);
    const before = state.snapshot();
    const projection = projectActorFields(state);
    const cells = projection.fields.filter(cell => cell.position.x === 0);
    const cell = cells.find(cell => cell.sourceId === 'source');
    const expected = cell ? actorFieldExposureAmount(receiver, cell, cells) : 0;
    const target = projection.sources.find(source => source.sourceId === 'source')!.targets.find(target => target.targetId === 'receiver');
    expect(target?.amount ?? 0, `${kind}:${expression}`).toBe(expected);
    expect(state.snapshot()).toEqual(before);
  }
});
test('projected emit and matching draw resolve finite absorption from actual owned equipment', () => {
  const state = registry([actor('fire', 0, fire), actor('absorber', 0, { kind: 'fire', expression: 'draw', stacks: 2 })]);
  const before = state.snapshot(); const result = resolveActorFields(state);
  expect(result.absorptions.reduce((sum, item) => sum + item.amount, 0)).toBe(3);
  expect(state.getActor('absorber')!.vitals.mana!.current).toBe(3);
  expect(state.getActor('absorber')!.vitals.health!.current).toBe(10);
  expect(state.getActor('fire')!.affinities).toEqual(before.actors.find(a => a.id === 'fire')!.affinities);
});
test('equally strong water emit counters fire locally without destroying inventory', () => {
  const state = registry([actor('fire', 0, fire), actor('water', 0, { ...fire, kind: 'water' }), actor('receiver', 0)]);
  const before = state.snapshot(); const projection = projectActorFields(state);
  expect(projection.fields.filter(cell => cell.position.x === 0)).toEqual([]);
  resolveActorFields(state);
  expect(state.snapshot()).toEqual(before);
});
test('overlap retains established intensity and residual-stack arithmetic', () => {
  expect(cancelAffinityOverlap(0.8, 5, 0.3, 2)).toEqual({ sourceIntensity: 0.5, sourceStacks: 3, targetIntensity: 0, targetStacks: 0 });
  expect(cancelAffinityOverlap(0.3, 5, 0.8, 2)).toEqual({ sourceIntensity: 0, sourceStacks: 0, targetIntensity: 0.5, targetStacks: 2 });
});
test('only active area pairs project; focused alternatives, movement and defeat update fields', () => {
  const source = actor('source', 0, { ...fire, stacks: 1 });
  source.affinities.push({ kind: 'water', expression: 'push', stacks: 8 });
  const state = registry([source]);
  const fields = projectActorFields(state).fields;
  expect(fields.map(cell => [cell.position.x, cell.kind, cell.intensity])).toEqual([[0, 'fire', 1], [2, 'fire', 0.5]]);
  state.moveActor('source', { x: 1, y: 0 });
  expect(projectActorFields(state).fields[0].position.x).toBe(1);
  state.equipAffinity('source', 'water:push');
  expect(projectActorFields(state).fields).toEqual([]);
  state.equipAffinity('source', 'fire:emit'); state.changeVital('source', 'health', -10);
  expect(projectActorFields(state).fields).toEqual([]);
});
test('light and dark retain net field observations independently of vital pools', () => {
  const light = registry([actor('source', 0, { ...fire, kind: 'light', stacks: 1 })]);
  expect(projectActorFields(light).fields[0]).toMatchObject({ kind: 'light', expression: 'emit', intensity: 1 });
  const dark = registry([actor('source', 0, { ...fire, kind: 'dark', stacks: 1 })]);
  expect(projectActorFields(dark).fields[0]).toMatchObject({ kind: 'dark', expression: 'emit', intensity: 1 });
});
test('canceled emission cannot be harvested by a nearby matching draw', () => {
  const state = registry([actor('fire', 0, fire), actor('water', 0, { ...fire, kind: 'water' }),
    actor('absorber', 0, { kind: 'fire', expression: 'draw', stacks: 2 })]);
  const result = resolveActorFields(state);
  expect(result.absorptions).toEqual([]);
  expect(state.getActor('absorber')!.vitals.mana!.current).toBe(0);
});
test('a source defeated during the pass neither emits later nor remains in returned fields', () => {
  const state = registry([actor('a', 0, { kind: 'decay', expression: 'emit', stacks: 10 }),
    actor('b', 0, fire), actor('c', 0)]);
  const result = resolveActorFields(state);
  expect(state.getActor('b')!.lifecycle).toBe('defeated');
  expect(state.getActor('c')!.vitals.health!.current).toBe(10);
  expect(result.fields.some(cell => cell.sourceId === 'b')).toBe(false);
});
// ## TODO: Test Permutations
// - Moderator must call this once after ordered actions; focused casts and UI consume the same projection.
