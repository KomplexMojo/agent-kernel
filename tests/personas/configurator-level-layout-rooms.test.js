const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const layoutModule = moduleUrl("packages/runtime/src/personas/configurator/level-layout.js");
const levelGenModule = moduleUrl("packages/runtime/src/personas/configurator/level-gen.js");

const tiers = [
  { name: "tier3", width: 20, height: 20, roomCount: 2, seed: 303 },
  { name: "tier4", width: 50, height: 50, roomCount: 3, seed: 404 },
  { name: "tier5", width: 100, height: 100, roomCount: 6, seed: 505 },
  { name: "tier6", width: 120, height: 120, roomCount: 12, seed: 606 },
];

test("room layouts are deterministic and connected for tiered sizes", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayout } from ${JSON.stringify(layoutModule)};

const tiers = ${JSON.stringify(tiers)};

function isWalkable(cell) {
  return cell !== "#";
}

function bfs(tiles, start) {
  const height = tiles.length;
  const width = tiles[0]?.length || 0;
  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const queue = [start];
  visited[start.y][start.x] = true;
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    neighbors.forEach((next) => {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) return;
      if (visited[next.y][next.x]) return;
      if (!isWalkable(tiles[next.y][next.x])) return;
      visited[next.y][next.x] = true;
      queue.push(next);
    });
  }
  return visited;
}

function roomAnchor(tiles, room) {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      if (isWalkable(tiles[y][x])) return { x, y };
    }
  }
  return {
    x: Math.floor(room.x + room.width / 2),
    y: Math.floor(room.y + room.height / 2),
  };
}

function roomCenter(room) {
  return {
    x: room.x + Math.floor(room.width / 2),
    y: room.y + Math.floor(room.height / 2),
  };
}

function roomForPoint(rooms, point) {
  return rooms.find((room) => (
    point.x >= room.x
    && point.x < room.x + room.width
    && point.y >= room.y
    && point.y < room.y + room.height
  )) || null;
}

function pickGreatestDeltaPair(rooms) {
  let best = null;
  for (let i = 0; i < rooms.length - 1; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = roomCenter(rooms[i]);
      const b = roomCenter(rooms[j]);
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      const score = {
        total: dx + dy,
        minAxis: Math.min(dx, dy),
        maxAxis: Math.max(dx, dy),
        i,
        j,
      };
      if (!best) {
        best = score;
        continue;
      }
      if (score.total > best.total) {
        best = score;
        continue;
      }
      if (score.total === best.total && score.minAxis > best.minAxis) {
        best = score;
        continue;
      }
      if (score.total === best.total && score.minAxis === best.minAxis && score.maxAxis > best.maxAxis) {
        best = score;
      }
    }
  }
  return best;
}

tiers.forEach((tier) => {
  const normalized = normalizeLevelGenInput({
    width: tier.width,
    height: tier.height,
    seed: tier.seed,
    shape: { roomCount: tier.roomCount },
  });
  assert.equal(normalized.ok, true);
  const layout = generateGridLayout(normalized.value);
  const layoutAgain = generateGridLayout(normalized.value);

  assert.equal(layout.width, tier.width);
  assert.equal(layout.height, tier.height);
  assert.ok(Array.isArray(layout.rooms));
  assert.ok(layout.rooms.length >= tier.roomCount);
  assert.equal(layoutAgain.tiles.join(""), layout.tiles.join(""));
  assert.deepEqual(layoutAgain.rooms, layout.rooms);

  const reachable = bfs(layout.tiles, layout.spawn);
  assert.equal(layout.kinds[layout.spawn.y][layout.spawn.x], 0);
  assert.equal(layout.kinds[layout.exit.y][layout.exit.x], 0);
  assert.equal(reachable[layout.exit.y][layout.exit.x], true);

  layout.rooms.forEach((room) => {
    const anchor = roomAnchor(layout.tiles, room);
    assert.equal(reachable[anchor.y][anchor.x], true);
  });

  assert.equal(layout.connectivity.rooms, layout.rooms.length);
  assert.equal(layout.connectivity.connectedRooms, layout.rooms.length);
  assert.equal(layout.connectivity.spawnReachable, true);
  assert.equal(layout.connectivity.exitReachable, true);

  const spawnRoom = roomForPoint(layout.rooms, layout.spawn);
  const exitRoom = roomForPoint(layout.rooms, layout.exit);
  assert.ok(spawnRoom, "spawn should land inside a room");
  assert.ok(exitRoom, "exit should land inside a room");

  const bestPair = pickGreatestDeltaPair(layout.rooms);
  assert.ok(bestPair, "expected at least two rooms for delta pair");
  const pairRooms = [layout.rooms[bestPair.i], layout.rooms[bestPair.j]];
  assert.equal(pairRooms.includes(spawnRoom), true, "spawn room should be part of max-delta pair");
  assert.equal(pairRooms.includes(exitRoom), true, "exit room should be part of max-delta pair");
});
`;
  runEsm(script);
});
