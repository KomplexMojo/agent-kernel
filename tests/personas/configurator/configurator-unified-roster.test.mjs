import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
import { createActorRegistry } from '../../../packages/core-ts/src/state/actor-registry.ts';
const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });
const geometry = { dimensions: { width: 3, height: 1 }, terrain: ['floor', 'floor', 'wall'] };
function definition(id, category = 'warden', patch = {}) {
  return { id, category, position: { x: 0, y: 0 },
    vitals: { health: { current: 10, max: 10, regen: 0 }, durability: { current: 3, max: 3, regen: 0 } }, ...patch };
}
test('assembles one sorted collection and prototype-safe presentation map independently of input order', () => {
  const actors = [definition('z', 'warden'), definition('__proto__', 'resource'), definition('constructor', 'hazard')];
  const result = c.normalizeActorRoster({ ...geometry, actors });
  expect(result.actors.map(a => a.id)).toEqual(['__proto__', 'constructor', 'z']);
  expect(Object.hasOwn(result.presentation, '__proto__')).toBe(true);
  expect(result.presentation.__proto__).toEqual({ category: 'resource' });
  expect(result.presentation.constructor).toEqual({ category: 'hazard' });
  expect(result.actors.every(a => !Object.hasOwn(a, 'category'))).toBe(true);
  expect(c.normalizeActorRoster({ ...geometry, actors: [...actors].reverse() })).toEqual(result);
  expect(createActorRegistry({ ...geometry, actors: result.actors }).snapshot().actors).toEqual(result.actors);
});
test('core validates blocking capabilities instead of authoring category', () => {
  expect(() => c.normalizeActorRoster({ ...geometry, actors: [definition('a'), definition('b', 'resource', {
    capabilities: { blocksMovement: true } })] })).toThrow(/blocking occupancy/);
  const result = c.normalizeActorRoster({ ...geometry, actors: [definition('a'), definition('b', 'barrier', {
    capabilities: { blocksMovement: false, canMove: true }, motivations: ['patrolling', 'attacking'] })] });
  expect(result.actors[1]).toMatchObject({ capabilities: { canMove: true, blocksMovement: false },
    motivations: ['patrolling', 'attacking'] });
});
test('rejects duplicate IDs and invalid terrain placement rather than omitting actors', () => {
  expect(() => c.normalizeActorRoster({ ...geometry, actors: [definition('a'), definition('a', 'resource')] })).toThrow(/duplicate actor id/);
  for (const x of [2, 3]) {
    expect(() => c.normalizeActorRoster({ ...geometry, actors: [definition('a', 'warden', { position: { x, y: 0 } })] })).toThrow(/invalid actor position/);
  }
  expect(() => c.normalizeActorRoster({ ...geometry, actors: null })).toThrow();
  expect(c.normalizeActorRoster({ ...geometry, actors: [] })).toEqual({ actors: [], presentation: {} });
});
test('zero defeat vital is normalized through core before occupancy and reward assembly', () => {
  const source = definition('source', 'warden', { vitals: { health: { current: 0, max: 10, regen: 1 } },
    affinities: [{ kind: 'fire', expression: 'emit', stacks: 8 }], activeAffinityKey: 'fire:emit' });
  const result = c.normalizeActorRoster({ ...geometry, actors: [source, definition('living')] });
  expect(result.actors.find(a => a.id === 'source')).toMatchObject({ lifecycle: 'defeated', holdings: [
    { id: 'affinity:fire:emit', kind: 'affinity', affinity: 'fire', expression: 'emit', claimedBy: null }] });
  expect(source.lifecycle).toBeUndefined();
});
test('assembly results and inputs have no shared mutable state', () => {
  const input = { ...structuredClone(geometry), actors: [definition('a')] };
  const before = structuredClone(input); const result = c.normalizeActorRoster(input);
  result.actors[0].vitals.health.current = 0; result.presentation.a.category = 'resource';
  expect(input).toEqual(before);
  expect(c.normalizeActorRoster(input).actors[0].vitals.health.current).toBe(10);
});
// ## TODO: Test Permutations
// - Artifact build and all three transports must use the roster normalizer.
