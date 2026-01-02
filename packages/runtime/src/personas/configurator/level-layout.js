import { normalizeLevelGenInput } from "./level-gen.js";

const DEFAULT_DENSITY = 0.35;
const DEFAULT_CLUSTER_SIZE = 6;

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
  if (profile === "rectangular") {
    seedRectangular(mask);
  } else if (profile === "sparse_islands") {
    const density = typeof levelGen.shape?.density === "number" ? levelGen.shape.density : DEFAULT_DENSITY;
    seedSparseIslands(mask, density, rng);
  } else if (profile === "clustered_islands") {
    const clusterSize = Number.isInteger(levelGen.shape?.clusterSize) ? levelGen.shape.clusterSize : DEFAULT_CLUSTER_SIZE;
    seedClusteredIslands(mask, clusterSize, rng);
  } else {
    seedRectangular(mask);
  }
  ensureWalkable(mask);
  return mask;
}

export function generateGridLayout(levelGen) {
  const seed = Number.isFinite(levelGen.seed) ? levelGen.seed : 0;
  const rng = createRng(seed);
  const mask = generateMask(levelGen, rng);
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
