import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
const c = createConfiguratorPersona({ clock: () => '2026-09-11T00:00:00Z' });
const input = { width: 9, height: 9, seed: 42, shape: { roomCount: 1, roomMinSize: 3, roomMaxSize: 3 } };

test('generated canonical terrain preserves the measured seeded room and markers', () => {
  const generated = c.generateGridLayoutFromInput(input);
  expect(generated.ok).toBe(true);
  const layout = generated.value;
  const rows = ['#########', '###ES####', '###...###', '###...###', '###...###',
    '#########', '#########', '#########', '#########'];
  const kind = { '#': 'wall', '.': 'floor', S: 'spawn', E: 'exit' };
  expect(layout.terrain).toEqual(rows.join('').split('').map(char => kind[char]));
  expect(layout.spawnApproach).toEqual({ x: 4, y: 2 });
  expect(layout.exitApproach).toEqual({ x: 3, y: 2 });
  for (const obsolete of ['tiles', 'kinds', 'legend', 'spawn', 'exit']) expect(Object.hasOwn(layout, obsolete)).toBe(false);
});

test('public generated terrain goes directly into the production SimConfig builder', () => {
  for (const seed of [0, 1, 7, 42, 100]) {
    const generated = c.generateGridLayoutFromInput({ ...input, seed });
    expect(generated.ok).toBe(true);
    const artifact = c.buildSimConfigArtifact({ meta: { id: 'generated' },
      planRef: { schema: 'agent-kernel/PlanArtifact', schemaVersion: 1, id: 'plan' },
      layout: generated.value, seed, movementStamina: {} });
    expect(artifact.layout.data.terrain).toEqual(generated.value.terrain);
    expect(c.normalizeActorRoster({ actors: [], dimensions: { width: input.width, height: input.height }, terrain: artifact.layout.data.terrain }).actors).toEqual([]);
    expect(c.generateGridLayoutFromInput({ ...input, seed })).toEqual(generated);
    artifact.layout.data.terrain[0] = 'floor';
    expect(generated.value.terrain[0]).toBe('wall');
  }
});
// ## TODO: Test Permutations
// - Generated hazard/resource actors after their authoring cutover.
