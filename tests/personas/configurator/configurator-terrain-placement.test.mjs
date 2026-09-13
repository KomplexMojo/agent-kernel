import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
const c = createConfiguratorPersona({ clock: () => '2026-09-11T00:00:00Z' });
const actor = (id, category) => ({ id, category, position: { x: 0, y: 0 },
  vitals: { health: { current: 10, max: 10, regen: 0 } },
  motivations: [category === 'delver' ? 'exploring' : 'defending'] });

test('generated canonical terrain supports placement and production InitialState assembly', () => {
  for (const seed of [1, 7, 42]) {
    const layout = c.generateGridLayoutFromInput({ width: 15, height: 15, seed,
      shape: { roomCount: 2, roomMinSize: 3, roomMaxSize: 4 } }).value;
    const actors = [actor('delver-a', 'delver'), actor('warden-b', 'warden')];
    const result = c.placeActors({ actors, layout, delverCount: 1 });
    const placed = result.actors;
    expect(new Set(placed.map(a => `${a.position.x},${a.position.y}`)).size).toBe(2);
    const primary = placed.find(a => a.id === 'delver-a');
    const spawnIndex = layout.terrain.indexOf('spawn');
    const spawn = { x: spawnIndex % layout.width, y: Math.floor(spawnIndex / layout.width) };
    const room = layout.rooms.find(room => room.id === layout.entryRoomId);
    const candidates = layout.terrain.flatMap((kind, index) => {
      const point = { x: index % layout.width, y: Math.floor(index / layout.width) };
      return kind === 'floor' && point.x >= room.x && point.x < room.x + room.width
        && point.y >= room.y && point.y < room.y + room.height ? [point] : [];
    });
    const distance = point => Math.abs(point.x - spawn.x) + Math.abs(point.y - spawn.y);
    candidates.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
    expect(primary.position).toEqual(candidates[0]);
    const initial = c.buildInitialStateArtifact({ meta: { id: 'placed' },
      simConfigRef: { id: 'config', schema: 'agent-kernel/SimConfigArtifact', schemaVersion: 1 },
      actors: placed, dimensions: { width: layout.width, height: layout.height }, terrain: layout.terrain });
    expect(initial.actors.map(a => a.position)).toEqual(placed.map(a => a.position));
    expect(actors[0].position).toEqual({ x: 0, y: 0 });
  }
});
// ## TODO: Test Permutations
// - Capability-driven co-occupancy after the placement policy migration.
