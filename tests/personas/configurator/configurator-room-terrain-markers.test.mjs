import { test, expect } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
test('room emitters avoid canonical spawn and exit markers across 1000 seeds', () => {
  const c = createConfiguratorPersona({ clock: () => '2026-09-12' });
  const invalid = [];
  for (let seed = 0; seed < 1000; seed++) {
    const layout = c.generateGridLayoutFromInput({ width: 9, height: 9, seed,
      shape: { roomCount: 1, roomMinSize: 3, roomMaxSize: 3 } }).value;
    const result = c.composeMixedRooms({ layout, seed, cardSet: [{ id: 'room', type: 'room', count: 1,
      affinities: [{ kind: 'fire', expression: 'emit', stacks: 1 }] }] });
    expect(result.generatedHazardCount).toBe(1);
    for (const hazard of result.layout.hazards) {
      const terrain = layout.terrain[hazard.y * layout.width + hazard.x];
      if (terrain !== 'floor') invalid.push({ seed, terrain });
    }
  }
  expect(invalid).toEqual([]);
});
// ## TODO: Test Permutations
// - Mixed template emitters after their common actor authoring migration.
