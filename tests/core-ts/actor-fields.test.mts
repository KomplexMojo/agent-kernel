import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { projectActorFields, resolveActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
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
