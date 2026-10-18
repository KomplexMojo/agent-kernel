/**
 * #398 — which cells of a level can be seen from a room's doorways, by core's own sight rule.
 *
 * Hiding is geometric: a cell is hidden from a room's doorways when no doorway has an
 * unobstructed line of sight to it. The line-of-sight test is core's (`computeVisibleCells`,
 * with an unbounded radius, so the answer never depends on light, dark or any affinity); the
 * Configurator only says which cells are doorways and which tiles are opaque.
 */
import { computeVisibleCells } from "../../../../core-ts/src/state/visibility.ts";
import { terrainPositions } from "./terrain-layout.js";

// The terrain core treats as opaque to sight (rules/actor-observation.ts).
const OPAQUE_TERRAIN = new Set(["wall", "spawn"]);

const key = ({ x, y }) => `${x},${y}`;

function dataOf(layout) {
  return layout?.data || layout || {};
}

function inRoom(room, { x, y }) {
  return x >= room.x && y >= room.y && x < room.x + room.width && y < room.y + room.height;
}

/** A room's doorways: walkable cells just outside it that touch one of its cells (4-neighbour). */
export function roomDoorways(layout, room) {
  const walkable = terrainPositions(layout);
  return walkable.filter((cell) => !inRoom(room, cell)
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inRoom(room, { x: cell.x + dx, y: cell.y + dy })));
}

/** Every cell some doorway of `room` can see, as a Set of "x,y" keys. */
export function cellsSeenFromDoorways(layout, room) {
  const data = dataOf(layout);
  const { width, height } = data;
  const terrain = Array.isArray(data.terrain) ? data.terrain : [];
  const kinds = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (
    OPAQUE_TERRAIN.has(terrain[y * width + x]) ? 1 : 0)));
  const seen = new Set();
  for (const doorway of roomDoorways(layout, room)) {
    const grid = computeVisibleCells(kinds, doorway, width + height);
    grid.forEach((row, y) => row.forEach((visible, x) => { if (visible) seen.add(`${x},${y}`); }));
  }
  return seen;
}

/** The walkable cells of `room` no doorway can see, in reading order. */
export function hiddenRoomCells(layout, room) {
  const seen = cellsSeenFromDoorways(layout, room);
  return terrainPositions(layout).filter((cell) => inRoom(room, cell) && !seen.has(key(cell)));
}
