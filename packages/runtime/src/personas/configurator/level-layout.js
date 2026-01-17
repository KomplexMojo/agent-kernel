import { normalizeLevelGenInput } from "./level-gen.js";

const DEFAULT_DENSITY = 0.35;
const DEFAULT_CLUSTER_SIZE = 6;
const DEFAULT_ROOM_COUNT = 4;
const DEFAULT_ROOM_MIN_SIZE = 3;
const DEFAULT_ROOM_MAX_SIZE = 9;
const DEFAULT_CORRIDOR_WIDTH = 1;
const ROOM_PLACEMENT_PADDING = 1;
const ROOM_PLACEMENT_ATTEMPTS = 40;

const KIND_STATIONARY = 0;
const KIND_BARRIER = 1;
const KIND_TRAP = 2;

const NEIGHBORS = Object.freeze([
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
]);

const DEFAULT_RENDER = Object.freeze({
  wall: "#",
  floor: ".",
  spawn: "S",
  exit: "E",
  actor: "@",
  barrier: "B",
});

function createRng(seed = 0) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(rng, max) {
  if (max <= 0) return 0;
  return Math.floor(rng() * max);
}

function randomIntBetween(rng, min, max) {
  if (max <= min) return min;
  return min + randomInt(rng, max - min + 1);
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createMask(width, height, value = false) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = new Array(width);
    row.fill(value);
    rows.push(row);
  }
  return rows;
}

function createNumberGrid(width, height, value = 0) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = new Array(width);
    row.fill(value);
    rows.push(row);
  }
  return rows;
}

function hasBorder(width, height) {
  return width > 2 && height > 2;
}

function isInteriorCell(x, y, width, height) {
  if (!hasBorder(width, height)) return true;
  return x > 0 && x < width - 1 && y > 0 && y < height - 1;
}

function isEdgeCell(x, y, width, height) {
  if (!hasBorder(width, height)) {
    return x === 0 || y === 0 || x === width - 1 || y === height - 1;
  }
  return x === 1 || y === 1 || x === width - 2 || y === height - 2;
}

function countNeighbors(mask, x, y) {
  let count = 0;
  for (const delta of NEIGHBORS) {
    const nx = x + delta.dx;
    const ny = y + delta.dy;
    if (ny < 0 || ny >= mask.length) continue;
    if (nx < 0 || nx >= mask[ny].length) continue;
    if (mask[ny][nx]) count += 1;
  }
  return count;
}

function seedRectangular(mask) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isInteriorCell(x, y, width, height)) {
        mask[y][x] = true;
      }
    }
  }
}

function seedSparseIslands(mask, density, rng) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInteriorCell(x, y, width, height)) continue;
      if (rng() < density) {
        mask[y][x] = true;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y][x]) continue;
      if (rng() > 0.5) continue;
      const delta = NEIGHBORS[randomInt(rng, NEIGHBORS.length)];
      const nx = x + delta.dx;
      const ny = y + delta.dy;
      if (isInteriorCell(nx, ny, width, height)) {
        mask[ny][nx] = true;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y][x]) continue;
      if (countNeighbors(mask, x, y) === 0) {
        mask[y][x] = false;
      }
    }
  }
}

function seedClusteredIslands(mask, clusterSize, rng) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const interiorCells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isInteriorCell(x, y, width, height)) {
        interiorCells.push({ x, y });
      }
    }
  }
  if (interiorCells.length === 0) {
    return;
  }

  const targetSize = Math.max(1, clusterSize);
  const clusterCount = Math.max(1, Math.floor(interiorCells.length / (targetSize * 2)));

  for (let i = 0; i < clusterCount; i += 1) {
    const start = interiorCells[randomInt(rng, interiorCells.length)];
    let current = { x: start.x, y: start.y };
    mask[current.y][current.x] = true;
    for (let step = 0; step < targetSize; step += 1) {
      const delta = NEIGHBORS[randomInt(rng, NEIGHBORS.length)];
      const next = { x: current.x + delta.dx, y: current.y + delta.dy };
      if (!isInteriorCell(next.x, next.y, width, height)) {
        continue;
      }
      current = next;
      mask[current.y][current.x] = true;
    }
  }
}

function readRoomSettings(levelGen) {
  const width = levelGen.width;
  const height = levelGen.height;
  const shape = levelGen.shape || {};
  const maxRoomSize = Math.max(1, Math.min(width, height) - 2);
  const maxRooms = Math.max(1, (width - 2) * (height - 2));

  const roomCount = clampInt(
    Number.isInteger(shape.roomCount) ? shape.roomCount : DEFAULT_ROOM_COUNT,
    1,
    maxRooms,
  );
  const roomMinSize = clampInt(
    Number.isInteger(shape.roomMinSize) ? shape.roomMinSize : DEFAULT_ROOM_MIN_SIZE,
    1,
    maxRoomSize,
  );
  const roomMaxSize = clampInt(
    Number.isInteger(shape.roomMaxSize) ? shape.roomMaxSize : DEFAULT_ROOM_MAX_SIZE,
    roomMinSize,
    maxRoomSize,
  );
  const corridorWidth = clampInt(
    Number.isInteger(shape.corridorWidth) ? shape.corridorWidth : DEFAULT_CORRIDOR_WIDTH,
    1,
    maxRoomSize,
  );

  return { roomCount, roomMinSize, roomMaxSize, corridorWidth };
}

function roomCenter(room) {
  return {
    x: Math.floor(room.x + room.width / 2),
    y: Math.floor(room.y + room.height / 2),
  };
}

function canPlaceRoom(mask, room, padding) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const startY = room.y - padding;
  const endY = room.y + room.height - 1 + padding;
  const startX = room.x - padding;
  const endX = room.x + room.width - 1 + padding;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (y < 0 || y >= height || x < 0 || x >= width) {
        return false;
      }
      if (!isInteriorCell(x, y, width, height)) {
        return false;
      }
      if (mask[y][x]) return false;
    }
  }
  return true;
}

function carveRoom(mask, room) {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      mask[y][x] = true;
    }
  }
}

function placeRooms(mask, rng, settings) {
  const rooms = [];
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const { roomCount, roomMinSize, roomMaxSize } = settings;
  const maxAttempts = Math.max(roomCount * ROOM_PLACEMENT_ATTEMPTS, ROOM_PLACEMENT_ATTEMPTS);

  let attempts = 0;
  while (rooms.length < roomCount && attempts < maxAttempts) {
    const roomWidth = randomIntBetween(rng, roomMinSize, roomMaxSize);
    const roomHeight = randomIntBetween(rng, roomMinSize, roomMaxSize);
    const maxX = width - roomWidth - 1;
    const maxY = height - roomHeight - 1;
    if (maxX < 1 || maxY < 1) {
      attempts += 1;
      continue;
    }
    const room = {
      x: randomIntBetween(rng, 1, maxX),
      y: randomIntBetween(rng, 1, maxY),
      width: roomWidth,
      height: roomHeight,
    };
    if (canPlaceRoom(mask, room, ROOM_PLACEMENT_PADDING)) {
      carveRoom(mask, room);
      rooms.push(room);
    }
    attempts += 1;
  }

  if (rooms.length < roomCount) {
    for (let y = 1; y <= height - roomMinSize - 1 && rooms.length < roomCount; y += 1) {
      for (let x = 1; x <= width - roomMinSize - 1 && rooms.length < roomCount; x += 1) {
        const room = { x, y, width: roomMinSize, height: roomMinSize };
        if (canPlaceRoom(mask, room, 0)) {
          carveRoom(mask, room);
          rooms.push(room);
        }
      }
    }
  }

  return rooms;
}

function carveCell(mask, x, y, corridorWidth) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const radius = Math.max(0, Math.floor((corridorWidth - 1) / 2));
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
      if (!isInteriorCell(nx, ny, width, height)) continue;
      mask[ny][nx] = true;
    }
  }
}

function carveLine(mask, from, to, corridorWidth) {
  if (from.x === to.x) {
    const start = Math.min(from.y, to.y);
    const end = Math.max(from.y, to.y);
    for (let y = start; y <= end; y += 1) {
      carveCell(mask, from.x, y, corridorWidth);
    }
    return;
  }
  if (from.y === to.y) {
    const start = Math.min(from.x, to.x);
    const end = Math.max(from.x, to.x);
    for (let x = start; x <= end; x += 1) {
      carveCell(mask, x, from.y, corridorWidth);
    }
  }
}

function carveCorridor(mask, from, to, corridorWidth, rng) {
  const horizontalFirst = rng() < 0.5;
  if (horizontalFirst) {
    carveLine(mask, { x: from.x, y: from.y }, { x: to.x, y: from.y }, corridorWidth);
    carveLine(mask, { x: to.x, y: from.y }, { x: to.x, y: to.y }, corridorWidth);
  } else {
    carveLine(mask, { x: from.x, y: from.y }, { x: from.x, y: to.y }, corridorWidth);
    carveLine(mask, { x: from.x, y: to.y }, { x: to.x, y: to.y }, corridorWidth);
  }
}

function connectRooms(mask, rooms, rng, corridorWidth) {
  if (rooms.length < 2) return;
  const centers = rooms.map(roomCenter);
  centers.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  for (let i = 1; i < centers.length; i += 1) {
    carveCorridor(mask, centers[i - 1], centers[i], corridorWidth, rng);
  }
}

function roomAnchor(mask, room) {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      if (mask[y]?.[x]) return { x, y };
    }
  }
  return roomCenter(room);
}

function ensureRoomsConnected(mask, rooms, rng, corridorWidth) {
  if (rooms.length < 2) {
    return { connectedRooms: rooms.length };
  }
  connectRooms(mask, rooms, rng, corridorWidth);
  const anchors = rooms.map((room) => roomAnchor(mask, room));
  const distances = distanceFrom(mask, anchors[0]);
  let connectedRooms = 0;
  anchors.forEach((anchor) => {
    if (distances[anchor.y]?.[anchor.x] >= 0) {
      connectedRooms += 1;
    }
  });

  let attempts = 0;
  while (connectedRooms < rooms.length && attempts < rooms.length) {
    const reachable = [];
    const unreachable = [];
    anchors.forEach((anchor) => {
      if (distances[anchor.y]?.[anchor.x] >= 0) {
        reachable.push(anchor);
      } else {
        unreachable.push(anchor);
      }
    });
    if (reachable.length === 0 || unreachable.length === 0) break;
    const target = unreachable[0];
    let closest = reachable[0];
    let bestDistance = manhattanDistance(target, closest);
    for (let i = 1; i < reachable.length; i += 1) {
      const candidate = reachable[i];
      const dist = manhattanDistance(target, candidate);
      if (dist < bestDistance) {
        bestDistance = dist;
        closest = candidate;
      }
    }
    carveCorridor(mask, target, closest, corridorWidth, rng);
    const nextDistances = distanceFrom(mask, anchors[0]);
    connectedRooms = 0;
    anchors.forEach((anchor) => {
      if (nextDistances[anchor.y]?.[anchor.x] >= 0) {
        connectedRooms += 1;
      }
    });
    attempts += 1;
  }

  return { connectedRooms };
}

function ensureWalkable(mask) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  let hasWalkable = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y][x]) {
        hasWalkable = true;
        break;
      }
    }
    if (hasWalkable) break;
  }
  if (!hasWalkable && width > 0 && height > 0) {
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    mask[cy][cx] = true;
  }
}

function buildTrapIndex(traps = []) {
  const index = new Set();
  for (const trap of traps) {
    if (!trap) continue;
    index.add(`${trap.x},${trap.y}`);
  }
  return index;
}

function isTrapCell(trapIndex, x, y) {
  if (!trapIndex) return false;
  return trapIndex.has(`${x},${y}`);
}

function applyTrapBlocking(mask, traps = []) {
  for (const trap of traps) {
    if (!trap?.blocking) continue;
    if (mask[trap.y] && typeof mask[trap.y][trap.x] === "boolean") {
      mask[trap.y][trap.x] = false;
    }
  }
}

function collectWalkable(mask, trapIndex) {
  const cells = [];
  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < mask[y].length; x += 1) {
      if (mask[y][x] && !isTrapCell(trapIndex, x, y)) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function pickCandidate(candidates, rng) {
  if (!candidates.length) return null;
  return candidates[randomInt(rng, candidates.length)];
}

function filterEdgeCandidates(candidates, width, height, edgeBias) {
  if (!edgeBias) return candidates;
  const edgeCandidates = candidates.filter((cell) => isEdgeCell(cell.x, cell.y, width, height));
  return edgeCandidates.length > 0 ? edgeCandidates : candidates;
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function distanceFrom(mask, start) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const distances = createNumberGrid(width, height, -1);
  const queue = [];
  queue.push(start);
  distances[start.y][start.x] = 0;
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const delta of NEIGHBORS) {
      const next = { x: current.x + delta.dx, y: current.y + delta.dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) continue;
      if (distances[next.y][next.x] >= 0) continue;
      if (!mask[next.y][next.x]) continue;
      distances[next.y][next.x] = distances[current.y][current.x] + 1;
      queue.push(next);
    }
  }
  return distances;
}

function filterReachable(candidates, distances) {
  if (!distances) return candidates;
  return candidates.filter((cell) => distances[cell.y]?.[cell.x] >= 0);
}

function pickFarthest(candidates, distances) {
  if (!candidates.length || !distances) return null;
  let best = null;
  let bestDistance = -1;
  for (const cell of candidates) {
    const distance = distances[cell.y]?.[cell.x] ?? -1;
    if (distance < 0) continue;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = cell;
      continue;
    }
    if (distance === bestDistance && best) {
      if (cell.y < best.y || (cell.y === best.y && cell.x < best.x)) {
        best = cell;
      }
    }
  }
  return best;
}

function placeSpawnExit(mask, levelGen, rng, trapIndex) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const cells = collectWalkable(mask, trapIndex);
  const fallbackCells = cells.length ? cells : collectWalkable(mask, null);
  const spawnCandidates = filterEdgeCandidates(cells, width, height, levelGen.spawn.edgeBias);
  const spawn = pickCandidate(spawnCandidates, rng) || cells[0] || fallbackCells[0] || { x: 0, y: 0 };

  const requirePath = levelGen.connectivity?.requirePath;
  const distances = requirePath ? distanceFrom(mask, spawn) : null;
  const minDistance = Math.max(levelGen.spawn.minDistance || 0, levelGen.exit.minDistance || 0);
  const baseCandidates = fallbackCells.filter((cell) => cell.x !== spawn.x || cell.y !== spawn.y);
  let exitCandidates = filterReachable(baseCandidates, distances).filter((cell) => manhattanDistance(cell, spawn) >= minDistance);
  exitCandidates = filterEdgeCandidates(exitCandidates, width, height, levelGen.exit.edgeBias);

  if (exitCandidates.length === 0) {
    exitCandidates = filterEdgeCandidates(filterReachable(baseCandidates, distances), width, height, levelGen.exit.edgeBias);
  }

  if (exitCandidates.length === 0) {
    exitCandidates = filterReachable(baseCandidates, distances);
  }

  const exit = pickCandidate(exitCandidates, rng) || pickFarthest(baseCandidates, distances) || spawn;
  return { spawn, exit };
}

function computeConnectivity(mask, rooms, spawn, exit) {
  if (!rooms || rooms.length === 0) return null;
  const distances = distanceFrom(mask, spawn);
  let connectedRooms = 0;
  rooms.forEach((room) => {
    const anchor = roomAnchor(mask, room);
    if (distances[anchor.y]?.[anchor.x] >= 0) {
      connectedRooms += 1;
    }
  });
  return {
    rooms: rooms.length,
    connectedRooms,
    spawnReachable: distances[spawn.y]?.[spawn.x] >= 0,
    exitReachable: distances[exit.y]?.[exit.x] >= 0,
  };
}

function buildTiles(mask, spawn, exit) {
  const tiles = [];
  for (let y = 0; y < mask.length; y += 1) {
    let row = "";
    for (let x = 0; x < mask[y].length; x += 1) {
      if (spawn.x === x && spawn.y === y) {
        row += "S";
      } else if (exit.x === x && exit.y === y) {
        row += "E";
      } else if (mask[y][x]) {
        row += ".";
      } else {
        row += "#";
      }
    }
    tiles.push(row);
  }
  return tiles;
}

function buildLegend() {
  return {
    "#": { tile: "wall" },
    ".": { tile: "floor" },
    S: { tile: "spawn" },
    E: { tile: "exit" },
    B: { tile: "barrier" },
  };
}

function buildKinds(mask, trapIndex) {
  const kinds = [];
  for (let y = 0; y < mask.length; y += 1) {
    const row = [];
    for (let x = 0; x < mask[y].length; x += 1) {
      let kind = mask[y][x] ? KIND_STATIONARY : KIND_BARRIER;
      if (isTrapCell(trapIndex, x, y)) {
        kind = KIND_TRAP;
      }
      row.push(kind);
    }
    kinds.push(row);
  }
  return kinds;
}

function generateMask(levelGen, rng) {
  const { width, height } = levelGen;
  const mask = createMask(width, height, false);
  const profile = levelGen.shape?.profile || "rectangular";
  let rooms = null;

  if (profile === "rectangular") {
    seedRectangular(mask);
  } else if (profile === "sparse_islands") {
    const density = typeof levelGen.shape?.density === "number" ? levelGen.shape.density : DEFAULT_DENSITY;
    seedSparseIslands(mask, density, rng);
  } else if (profile === "clustered_islands") {
    const clusterSize = Number.isInteger(levelGen.shape?.clusterSize) ? levelGen.shape.clusterSize : DEFAULT_CLUSTER_SIZE;
    seedClusteredIslands(mask, clusterSize, rng);
  } else if (profile === "rooms") {
    const settings = readRoomSettings(levelGen);
    rooms = placeRooms(mask, rng, settings);
    ensureRoomsConnected(mask, rooms, rng, settings.corridorWidth);
  } else {
    seedRectangular(mask);
  }
  ensureWalkable(mask);
  return { mask, rooms };
}

export function generateGridLayout(levelGen) {
  const seed = Number.isFinite(levelGen.seed) ? levelGen.seed : 0;
  const rng = createRng(seed);
  const { mask, rooms } = generateMask(levelGen, rng);
  const traps = Array.isArray(levelGen.traps) ? levelGen.traps : [];
  applyTrapBlocking(mask, traps);
  const trapIndex = buildTrapIndex(traps);
  const { spawn, exit } = placeSpawnExit(mask, levelGen, rng, trapIndex);
  const layout = {
    width: levelGen.width,
    height: levelGen.height,
    tiles: buildTiles(mask, spawn, exit),
    kinds: buildKinds(mask, trapIndex),
    legend: buildLegend(),
    render: { ...DEFAULT_RENDER },
    spawn,
    exit,
    bounds: "walls_block_movement",
  };
  if (rooms && rooms.length > 0) {
    layout.rooms = rooms.map((room) => ({ ...room }));
    const connectivity = computeConnectivity(mask, rooms, spawn, exit);
    if (connectivity) {
      layout.connectivity = connectivity;
    }
  }
  if (traps.length > 0) {
    layout.traps = traps.map((trap) => ({ ...trap }));
  }
  return layout;
}

export function generateGridLayoutFromInput(input) {
  const normalized = normalizeLevelGenInput(input);
  if (!normalized.ok) {
    return normalized;
  }
  return {
    ok: true,
    errors: [],
    warnings: normalized.warnings,
    value: generateGridLayout(normalized.value),
  };
}
