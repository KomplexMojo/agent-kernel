import { normalizeLevelGenInput } from "./level-gen.js";
import { LEVEL_GEN_DEFAULTS } from "./defaults.js";

const DEFAULT_ROOM_COUNT = 4;
const DEFAULT_ROOM_MIN_SIZE = 3;
const DEFAULT_ROOM_MAX_SIZE = 9;
const DEFAULT_CORRIDOR_WIDTH = 1;
const ROOM_PLACEMENT_PADDING = 1;
const ROOM_PLACEMENT_ATTEMPTS = 40;
const TARGET_ROOM_WALKABLE_SHARE = 0.85;
const ORGANIC_EDGE_DEPTH = 3;
const ORGANIC_EDGE_CUT_CHANCE = 0.42;
const ORGANIC_EDGE_HEAL_CHANCE = 0.25;
const ORGANIC_EDGE_PASSES = 1;

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
const LEVEL_PATTERN_TYPES = Object.freeze({
  none: "none",
  grid: "grid",
  diagonalGrid: "diagonal_grid",
  concentricCircles: "concentric_circles",
});
const PATTERN_GAP_AXES = Object.freeze({
  x: "x",
  y: "y",
  sum: "sum",
  diff: "diff",
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

function applyOrganicEdgePerturbation(mask, rng) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  if (height <= 4 || width <= 4) return;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (!mask[y][x]) continue;
      const edgeDistance = Math.min(x - 1, y - 1, width - 2 - x, height - 2 - y);
      if (edgeDistance < 0 || edgeDistance > ORGANIC_EDGE_DEPTH) continue;
      const weight = (ORGANIC_EDGE_DEPTH - edgeDistance + 1) / (ORGANIC_EDGE_DEPTH + 1);
      if (rng() < ORGANIC_EDGE_CUT_CHANCE * weight) {
        mask[y][x] = false;
      }
    }
  }

  for (let pass = 0; pass < ORGANIC_EDGE_PASSES; pass += 1) {
    const next = createMask(width, height, false);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isInteriorCell(x, y, width, height)) {
          next[y][x] = false;
          continue;
        }
        const edgeDistance = Math.min(x - 1, y - 1, width - 2 - x, height - 2 - y);
        if (edgeDistance > ORGANIC_EDGE_DEPTH + 1) {
          next[y][x] = mask[y][x];
          continue;
        }
        const neighbors = countNeighbors(mask, x, y);
        if (mask[y][x]) {
          next[y][x] = neighbors >= 2;
        } else {
          const weight = (ORGANIC_EDGE_DEPTH - Math.max(0, edgeDistance) + 1) / (ORGANIC_EDGE_DEPTH + 1);
          next[y][x] = neighbors >= 3 && rng() < ORGANIC_EDGE_HEAL_CHANCE * weight;
        }
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        mask[y][x] = next[y][x];
      }
    }
  }
}

function resolveWalkableTilesTarget(levelGen) {
  const parsed = Number(levelGen?.walkableTilesTarget);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

function countWalkableMask(mask) {
  let count = 0;
  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < (mask[y]?.length || 0); x += 1) {
      if (mask[y][x]) count += 1;
    }
  }
  return count;
}

function countWalkableCapacity(mask, blockedIndex = null) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInteriorCell(x, y, width, height)) continue;
      if (blockedIndex?.has(`${x},${y}`)) continue;
      count += 1;
    }
  }
  return count;
}

function findFirstWalkable(mask) {
  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < (mask[y]?.length || 0); x += 1) {
      if (mask[y][x]) return { x, y };
    }
  }
  return null;
}

function isMaskConnected(mask, anchor = null) {
  const start = anchor && mask[anchor.y]?.[anchor.x] ? anchor : findFirstWalkable(mask);
  if (!start) return true;
  const distances = distanceFrom(mask, start);
  let total = 0;
  let reachable = 0;
  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < (mask[y]?.length || 0); x += 1) {
      if (!mask[y][x]) continue;
      total += 1;
      if (distances[y]?.[x] >= 0) reachable += 1;
    }
  }
  return reachable === total;
}

function isStraightCorridor(directions) {
  if (!Array.isArray(directions) || directions.length !== 2) return false;
  return directions[0].dx + directions[1].dx === 0 && directions[0].dy + directions[1].dy === 0;
}

function buildBackbonePath(mask, anchor = null) {
  const start = anchor && mask[anchor.y]?.[anchor.x] ? anchor : findFirstWalkable(mask);
  if (!start) return [];
  const distances = distanceFrom(mask, start);
  let farthest = start;
  let farthestDistance = distances[start.y]?.[start.x] ?? 0;

  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < (mask[y]?.length || 0); x += 1) {
      if (!mask[y][x]) continue;
      const distance = distances[y]?.[x] ?? -1;
      if (distance < 0) continue;
      if (
        distance > farthestDistance
        || (
          distance === farthestDistance
          && (y < farthest.y || (y === farthest.y && x < farthest.x))
        )
      ) {
        farthest = { x, y };
        farthestDistance = distance;
      }
    }
  }

  if (farthestDistance <= 0) {
    return [start];
  }

  const path = [farthest];
  let cursor = farthest;
  let cursorDistance = farthestDistance;
  while (cursorDistance > 0) {
    let next = null;
    for (const delta of NEIGHBORS) {
      const nx = cursor.x + delta.dx;
      const ny = cursor.y + delta.dy;
      if (ny < 0 || ny >= mask.length) continue;
      if (nx < 0 || nx >= (mask[ny]?.length || 0)) continue;
      if (!mask[ny][nx]) continue;
      if ((distances[ny]?.[nx] ?? -1) !== cursorDistance - 1) continue;
      if (!next || ny < next.y || (ny === next.y && nx < next.x)) {
        next = { x: nx, y: ny };
      }
    }
    if (!next) break;
    path.push(next);
    cursor = next;
    cursorDistance -= 1;
  }
  path.reverse();
  return path;
}

function collectTopologyPreserve(mask, blockedIndex = null, anchor = null) {
  const preserve = new Set();
  const height = mask.length;
  const width = mask[0]?.length || 0;

  const backbone = buildBackbonePath(mask, anchor);
  backbone.forEach((pos) => preserve.add(`${pos.x},${pos.y}`));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y][x]) continue;
      if (!isInteriorCell(x, y, width, height)) continue;
      if (blockedIndex?.has(`${x},${y}`)) continue;
      const directions = [];
      for (const delta of NEIGHBORS) {
        const nx = x + delta.dx;
        const ny = y + delta.dy;
        if (ny < 0 || ny >= height) continue;
        if (nx < 0 || nx >= width) continue;
        if (!mask[ny][nx]) continue;
        directions.push(delta);
      }
      if (directions.length === 2 && !isStraightCorridor(directions)) {
        preserve.add(`${x},${y}`);
      }
    }
  }

  return preserve;
}

function reconcileConnectedWalkableTiles({
  mask,
  target,
  isEligible,
  anchor,
} = {}) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const totalCells = width * height;
  const toIndex = (x, y) => (y * width) + x;
  const toPoint = (index) => {
    const y = Math.floor(index / width);
    return { x: index - (y * width), y };
  };
  const resolveAnchor = () => {
    if (anchor && isEligible(anchor.x, anchor.y)) {
      return { x: anchor.x, y: anchor.y };
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (mask[y][x] && isEligible(x, y)) {
          return { x, y };
        }
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (isEligible(x, y)) {
          return { x, y };
        }
      }
    }
    return null;
  };

  const anchorCell = resolveAnchor();
  if (!anchorCell) {
    return;
  }
  if (!mask[anchorCell.y][anchorCell.x]) {
    mask[anchorCell.y][anchorCell.x] = true;
  }

  const selected = new Uint8Array(totalCells);
  const queuedWalkable = new Uint8Array(totalCells);
  const queuedExpansion = new Uint8Array(totalCells);
  const walkableQueue = [];
  const expansionQueue = [];

  const tryQueueWalkable = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    if (!isEligible(x, y)) return;
    if (!mask[y][x]) return;
    const index = toIndex(x, y);
    if (queuedWalkable[index]) return;
    queuedWalkable[index] = 1;
    walkableQueue.push(index);
  };

  const tryQueueExpansion = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    if (!isEligible(x, y)) return;
    const index = toIndex(x, y);
    if (selected[index] || queuedExpansion[index]) return;
    queuedExpansion[index] = 1;
    expansionQueue.push(index);
  };

  const selectCell = (index) => {
    if (selected[index]) return false;
    selected[index] = 1;
    return true;
  };

  tryQueueWalkable(anchorCell.x, anchorCell.y);
  let walkableHead = 0;
  let selectedCount = 0;

  while (walkableHead < walkableQueue.length && selectedCount < target) {
    const index = walkableQueue[walkableHead];
    walkableHead += 1;
    const current = toPoint(index);
    if (selectCell(index)) {
      selectedCount += 1;
    }

    for (const delta of NEIGHBORS) {
      const nx = current.x + delta.dx;
      const ny = current.y + delta.dy;
      if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
      if (!isEligible(nx, ny)) continue;
      if (mask[ny][nx]) {
        tryQueueWalkable(nx, ny);
      } else {
        tryQueueExpansion(nx, ny);
      }
    }
  }

  let expansionHead = 0;
  while (selectedCount < target && expansionHead < expansionQueue.length) {
    const index = expansionQueue[expansionHead];
    expansionHead += 1;
    const current = toPoint(index);
    if (!isEligible(current.x, current.y)) {
      continue;
    }
    if (selectCell(index)) {
      selectedCount += 1;
    }
    for (const delta of NEIGHBORS) {
      tryQueueExpansion(current.x + delta.dx, current.y + delta.dy);
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isEligible(x, y)) continue;
      const index = toIndex(x, y);
      mask[y][x] = selected[index] === 1;
    }
  }
}

function reconcileWalkableTiles({
  mask,
  targetWalkableTiles,
  blockedIndex = null,
  requireConnected = false,
  anchor = null,
  preserve = [],
} = {}) {
  if (!Array.isArray(mask) || mask.length === 0) return;
  if (!Number.isInteger(targetWalkableTiles) || targetWalkableTiles <= 0) return;

  const height = mask.length;
  const width = mask[0]?.length || 0;
  if (width <= 0) return;

  const capacity = countWalkableCapacity(mask, blockedIndex);
  const target = Math.min(targetWalkableTiles, capacity);
  if (target <= 0) return;

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const preserveSet = new Set(
    (Array.isArray(preserve) ? preserve : [])
      .filter((pos) => Number.isInteger(pos?.x) && Number.isInteger(pos?.y))
      .map((pos) => `${pos.x},${pos.y}`),
  );
  const topologyPreserve = collectTopologyPreserve(mask, blockedIndex, anchor);
  topologyPreserve.forEach((key) => preserveSet.add(key));
  const isEligible = (x, y) => (
    isInteriorCell(x, y, width, height)
    && !blockedIndex?.has(`${x},${y}`)
  );

  if (requireConnected) {
    reconcileConnectedWalkableTiles({
      mask,
      target,
      isEligible,
      anchor,
    });
    return;
  }

  let current = countWalkableMask(mask);
  const fastReconcileWithoutConnectivity = () => {
    const collectAddCandidates = () => {
      const candidates = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!isEligible(x, y) || mask[y][x]) continue;
          const neighbors = countNeighbors(mask, x, y);
          if (current > 0 && neighbors <= 0) continue;
          const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
          const tier = neighbors === 1 ? 4 : neighbors === 2 ? 3 : neighbors === 3 ? 2 : neighbors >= 4 ? 1 : 0;
          candidates.push({ x, y, tier, distance });
        }
      }
      candidates.sort((a, b) => {
        if (a.tier !== b.tier) return b.tier - a.tier;
        if (a.distance !== b.distance) return b.distance - a.distance;
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });
      return candidates;
    };

    const collectPruneCandidates = ({ allowPreserved } = { allowPreserved: false }) => {
      const candidates = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!isEligible(x, y) || !mask[y][x]) continue;
          const key = `${x},${y}`;
          if (!allowPreserved && preserveSet.has(key)) continue;
          const neighbors = countNeighbors(mask, x, y);
          const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
          const tier = neighbors >= 4 ? 4 : neighbors === 3 ? 3 : neighbors === 2 ? 2 : neighbors === 1 ? 1 : 0;
          candidates.push({ x, y, tier, distance, key });
        }
      }
      candidates.sort((a, b) => {
        if (a.tier !== b.tier) return b.tier - a.tier;
        if (a.distance !== b.distance) return a.distance - b.distance;
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });
      return candidates;
    };

    if (current < target) {
      const needed = target - current;
      const addCandidates = collectAddCandidates();
      for (let i = 0; i < addCandidates.length && i < needed; i += 1) {
        const candidate = addCandidates[i];
        mask[candidate.y][candidate.x] = true;
        current += 1;
      }
    } else if (current > target) {
      const needed = current - target;
      let pruneCandidates = collectPruneCandidates({ allowPreserved: false });
      if (pruneCandidates.length < needed && preserveSet.size > 0) {
        const withPreserved = collectPruneCandidates({ allowPreserved: true });
        const seen = new Set(pruneCandidates.map((candidate) => candidate.key));
        withPreserved.forEach((candidate) => {
          if (seen.has(candidate.key)) return;
          pruneCandidates.push(candidate);
        });
      }
      for (let i = 0; i < pruneCandidates.length && i < needed; i += 1) {
        const candidate = pruneCandidates[i];
        mask[candidate.y][candidate.x] = false;
        current -= 1;
      }
    }
  };

  if (!requireConnected) {
    fastReconcileWithoutConnectivity();
  }

  const maxIterations = Math.max(1, width * height * 4);
  let iterations = 0;

  while (current < target && iterations < maxIterations) {
    let best = null;
    let bestTier = -1;
    let bestDistance = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isEligible(x, y) || mask[y][x]) continue;
        const neighbors = countNeighbors(mask, x, y);
        if (current > 0 && neighbors <= 0) continue;
        const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
        const tier = neighbors === 1 ? 4 : neighbors === 2 ? 3 : neighbors === 3 ? 2 : neighbors >= 4 ? 1 : 0;
        if (
          tier > bestTier
          || (tier === bestTier && distance > bestDistance)
          || (tier === bestTier && distance === bestDistance && best && ((y < best.y) || (y === best.y && x < best.x)))
          || (tier === bestTier && distance === bestDistance && !best)
        ) {
          best = { x, y };
          bestTier = tier;
          bestDistance = distance;
        }
      }
    }

    if (!best && !requireConnected) {
      for (let y = 0; y < height && !best; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!isEligible(x, y) || mask[y][x]) continue;
          best = { x, y };
          break;
        }
      }
    }

    if (!best) break;
    mask[best.y][best.x] = true;
    current += 1;
    iterations += 1;
  }

  while (current > target && iterations < maxIterations) {
    const selectPruneCandidate = (allowPreserved) => {
      let best = null;
      let bestTier = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!mask[y][x] || !isEligible(x, y)) continue;
          const key = `${x},${y}`;
          if (!allowPreserved && preserveSet.has(key)) continue;
          const neighbors = countNeighbors(mask, x, y);
          let removable = true;
          if (requireConnected && current > 1 && neighbors > 1) {
            mask[y][x] = false;
            removable = isMaskConnected(mask, anchor);
            mask[y][x] = true;
          }
          if (!removable) continue;
          const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
          const tier = neighbors >= 4 ? 4 : neighbors === 3 ? 3 : neighbors === 2 ? 2 : neighbors === 1 ? 1 : 0;
          if (
            tier > bestTier
            || (tier === bestTier && distance < bestDistance)
            || (tier === bestTier && distance === bestDistance && best && ((y < best.y) || (y === best.y && x < best.x)))
            || (tier === bestTier && distance === bestDistance && !best)
          ) {
            best = { x, y };
            bestTier = tier;
            bestDistance = distance;
          }
        }
      }
      return best;
    };

    let best = selectPruneCandidate(false);
    if (!best && preserveSet.size > 0) {
      best = selectPruneCandidate(true);
    }

    if (!best) break;
    mask[best.y][best.x] = false;
    current -= 1;
    iterations += 1;
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
  const walkableTilesTarget = resolveWalkableTilesTarget(levelGen);
  if (walkableTilesTarget === null) {
    return { roomCount, roomMinSize, roomMaxSize, corridorWidth };
  }
  const interiorCapacity = countWalkableCapacity(createMask(width, height, false));
  const normalizedWalkableTarget = Math.min(walkableTilesTarget, interiorCapacity);
  const averageRoomSide = Math.max(1, (roomMinSize + roomMaxSize) / 2);
  const averageRoomArea = Math.max(1, Math.round(averageRoomSide * averageRoomSide));
  const desiredRoomTiles = Math.max(1, Math.round(normalizedWalkableTarget * TARGET_ROOM_WALKABLE_SHARE));
  const targetRoomCount = clampInt(
    Math.ceil(desiredRoomTiles / averageRoomArea),
    1,
    maxRooms,
  );
  return {
    roomCount: Math.max(roomCount, targetRoomCount),
    roomMinSize,
    roomMaxSize,
    corridorWidth,
  };
}

function roomCenter(room) {
  return {
    x: Math.floor(room.x + room.width / 2),
    y: Math.floor(room.y + room.height / 2),
  };
}

function roomIdAt(room, index) {
  if (typeof room?.id === "string" && room.id.trim()) return room.id.trim();
  return `R${index + 1}`;
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
      id: `R${rooms.length + 1}`,
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
        const room = {
          id: `R${rooms.length + 1}`,
          x,
          y,
          width: roomMinSize,
          height: roomMinSize,
        };
        if (canPlaceRoom(mask, room, 0)) {
          carveRoom(mask, room);
          rooms.push(room);
        }
      }
    }
  }

  return rooms;
}

function normalizePatternType(rawPattern) {
  if (typeof rawPattern !== "string") return LEVEL_PATTERN_TYPES.grid;
  const normalizedPattern = rawPattern.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalizedPattern === LEVEL_PATTERN_TYPES.none) return LEVEL_PATTERN_TYPES.none;
  if (normalizedPattern === LEVEL_PATTERN_TYPES.grid) return LEVEL_PATTERN_TYPES.grid;
  if (normalizedPattern === LEVEL_PATTERN_TYPES.diagonalGrid || normalizedPattern === "diagonal") {
    return LEVEL_PATTERN_TYPES.diagonalGrid;
  }
  if (normalizedPattern === LEVEL_PATTERN_TYPES.concentricCircles || normalizedPattern === "concentric") {
    return LEVEL_PATTERN_TYPES.concentricCircles;
  }
  if (normalizedPattern === "horizontal_vertical_grid" || normalizedPattern === "horizontal_verticle_grid") {
    return LEVEL_PATTERN_TYPES.grid;
  }
  return LEVEL_PATTERN_TYPES.grid;
}

function derivePatternSpacingFromInfillPercent(infillPercent, maxPatternStride) {
  const normalizedInfill = clampInt(infillPercent, 1, 100);
  const spacingFromInfill = Math.round((110 - normalizedInfill) / 10);
  return clampInt(spacingFromInfill, 2, maxPatternStride);
}

function readPatternSettings(levelGen) {
  const shape = levelGen?.shape && typeof levelGen.shape === "object" ? levelGen.shape : {};
  const type = normalizePatternType(shape.pattern);
  if (type === LEVEL_PATTERN_TYPES.none) {
    return { type };
  }
  const width = Math.max(1, levelGen?.width || 1);
  const height = Math.max(1, levelGen?.height || 1);
  const maxPatternStride = Math.max(2, Math.max(width, height) - 2);
  const maxPatternLineWidth = Math.max(1, Math.min(width, height) - 2);
  const maxPatternInset = Math.max(0, Math.min(width, height) - 3);
  const infillPercent = Number.isInteger(shape.patternInfillPercent)
    ? clampInt(shape.patternInfillPercent, 1, 100)
    : null;
  const spacingFromShape = clampInt(
    Number.isInteger(shape.patternSpacing) ? shape.patternSpacing : LEVEL_GEN_DEFAULTS.patternSpacing,
    2,
    maxPatternStride,
  );
  return {
    type,
    spacing: Number.isInteger(infillPercent)
      ? derivePatternSpacingFromInfillPercent(infillPercent, maxPatternStride)
      : spacingFromShape,
    lineWidth: clampInt(
      Number.isInteger(shape.patternLineWidth) ? shape.patternLineWidth : LEVEL_GEN_DEFAULTS.patternLineWidth,
      1,
      maxPatternLineWidth,
    ),
    gapEvery: clampInt(
      Number.isInteger(shape.patternGapEvery) ? shape.patternGapEvery : LEVEL_GEN_DEFAULTS.patternGapEvery,
      2,
      Math.max(2, maxPatternLineWidth),
    ),
    inset: clampInt(
      Number.isInteger(shape.patternInset) ? shape.patternInset : LEVEL_GEN_DEFAULTS.patternInset,
      0,
      maxPatternInset,
    ),
    infillPercent,
  };
}

function buildRoomIndex(width, height, rooms) {
  const index = createNumberGrid(width, height, -1);
  for (let roomId = 0; roomId < rooms.length; roomId += 1) {
    const room = rooms[roomId];
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (y < 0 || y >= height || x < 0 || x >= width) continue;
        index[y][x] = roomId;
      }
    }
  }
  return index;
}

function isOnGridLine(coord, spacing, lineWidth, phaseOffset = 1) {
  const normalized = ((coord - phaseOffset) % spacing + spacing) % spacing;
  if (lineWidth <= 1) return normalized === 0;
  return normalized < lineWidth;
}

function roomEdgeDistance(room, x, y) {
  return Math.min(
    x - room.x,
    room.x + room.width - 1 - x,
    y - room.y,
    room.y + room.height - 1 - y,
  );
}

function resolvePatternGapOffset(axis, x, y, room) {
  switch (axis) {
    case PATTERN_GAP_AXES.x:
      return x - room.x;
    case PATTERN_GAP_AXES.y:
      return y - room.y;
    case PATTERN_GAP_AXES.sum:
      return (x - room.x) + (y - room.y);
    case PATTERN_GAP_AXES.diff:
      return (x - room.x) - (y - room.y);
    default:
      return null;
  }
}

function shouldPreservePatternGap({ x, y, room, activeAxes = [], gapEvery, inset }) {
  if (!room) return false;
  const edgeDistance = roomEdgeDistance(room, x, y);
  // Never convert room perimeter tiles into barriers; perimeter cells act as
  // guaranteed door candidates even when patternInset is zero.
  if (edgeDistance <= 0) {
    return true;
  }
  if (edgeDistance < inset) {
    return true;
  }
  if (!Array.isArray(activeAxes) || activeAxes.length === 0) {
    return false;
  }
  if (activeAxes.length >= 2) {
    return true;
  }
  for (let i = 0; i < activeAxes.length; i += 1) {
    const offset = resolvePatternGapOffset(activeAxes[i], x, y, room);
    if (!Number.isFinite(offset)) continue;
    const normalizedOffset = ((offset % gapEvery) + gapEvery) % gapEvery;
    if (normalizedOffset === 0) {
      return true;
    }
  }
  return false;
}

function evaluatePatternCell(pattern, x, y, width, height) {
  if (pattern.type === LEVEL_PATTERN_TYPES.grid) {
    const onVertical = isOnGridLine(x, pattern.spacing, pattern.lineWidth);
    const onHorizontal = isOnGridLine(y, pattern.spacing, pattern.lineWidth);
    return {
      onPatternLine: onVertical || onHorizontal,
      activeAxes: [
        onVertical ? PATTERN_GAP_AXES.y : null,
        onHorizontal ? PATTERN_GAP_AXES.x : null,
      ].filter(Boolean),
    };
  }
  if (pattern.type === LEVEL_PATTERN_TYPES.diagonalGrid) {
    const onDiagForward = isOnGridLine(x + y, pattern.spacing, pattern.lineWidth, 2);
    const onDiagBackward = isOnGridLine(x - y, pattern.spacing, pattern.lineWidth, 0);
    return {
      onPatternLine: onDiagForward || onDiagBackward,
      activeAxes: [
        onDiagForward ? PATTERN_GAP_AXES.x : null,
        onDiagBackward ? PATTERN_GAP_AXES.y : null,
      ].filter(Boolean),
    };
  }
  if (pattern.type === LEVEL_PATTERN_TYPES.concentricCircles) {
    const centerX = (width - 1) / 2;
    const centerY = (height - 1) / 2;
    const radius = Math.round(Math.hypot(x - centerX, y - centerY));
    const onRing = isOnGridLine(radius, pattern.spacing, pattern.lineWidth, 1);
    return {
      onPatternLine: onRing,
      activeAxes: onRing ? [PATTERN_GAP_AXES.sum] : [],
    };
  }
  return { onPatternLine: false, activeAxes: [] };
}

function applyPatternOverlay(mask, rooms, levelGen) {
  if (!Array.isArray(mask) || mask.length === 0) return;
  const pattern = readPatternSettings(levelGen);
  if (pattern.type === LEVEL_PATTERN_TYPES.none) return;

  const height = mask.length;
  const width = mask[0]?.length || 0;
  if (width <= 0 || height <= 0) return;

  const roomIndex = buildRoomIndex(width, height, rooms || []);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInteriorCell(x, y, width, height)) continue;
      const { onPatternLine, activeAxes } = evaluatePatternCell(pattern, x, y, width, height);
      if (!onPatternLine) continue;

      const roomId = roomIndex[y]?.[x] ?? -1;
      if (roomId >= 0) {
        const room = rooms[roomId];
        if (shouldPreservePatternGap({
          x,
          y,
          room,
          activeAxes,
          gapEvery: pattern.gapEvery,
          inset: pattern.inset,
        })) {
          continue;
        }
        mask[y][x] = false;
      } else {
        mask[y][x] = true;
      }
    }
  }
}

function carveCell(mask, x, y, corridorWidth, blockedIndex = null) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const radius = Math.max(0, Math.floor((corridorWidth - 1) / 2));
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
      if (!isInteriorCell(nx, ny, width, height)) continue;
      if (blockedIndex?.has(`${nx},${ny}`)) continue;
      mask[ny][nx] = true;
    }
  }
}

function carveLine(mask, from, to, corridorWidth, blockedIndex = null) {
  if (from.x === to.x) {
    const start = Math.min(from.y, to.y);
    const end = Math.max(from.y, to.y);
    for (let y = start; y <= end; y += 1) {
      carveCell(mask, from.x, y, corridorWidth, blockedIndex);
    }
    return;
  }
  if (from.y === to.y) {
    const start = Math.min(from.x, to.x);
    const end = Math.max(from.x, to.x);
    for (let x = start; x <= end; x += 1) {
      carveCell(mask, x, from.y, corridorWidth, blockedIndex);
    }
  }
}

function carveCorridor(mask, from, to, corridorWidth, rng, blockedIndex = null) {
  const horizontalFirst = rng() < 0.5;
  if (horizontalFirst) {
    carveLine(mask, { x: from.x, y: from.y }, { x: to.x, y: from.y }, corridorWidth, blockedIndex);
    carveLine(mask, { x: to.x, y: from.y }, { x: to.x, y: to.y }, corridorWidth, blockedIndex);
  } else {
    carveLine(mask, { x: from.x, y: from.y }, { x: from.x, y: to.y }, corridorWidth, blockedIndex);
    carveLine(mask, { x: from.x, y: to.y }, { x: to.x, y: to.y }, corridorWidth, blockedIndex);
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

function buildBlockingTrapIndex(traps = []) {
  const index = new Set();
  for (const trap of traps) {
    if (!trap?.blocking) continue;
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

function pointInRoom(room, point) {
  if (!room || !point) return false;
  return (
    point.x >= room.x
    && point.x < room.x + room.width
    && point.y >= room.y
    && point.y < room.y + room.height
  );
}

function findRoomIndexForPoint(rooms, point) {
  if (!Array.isArray(rooms) || !point) return -1;
  for (let i = 0; i < rooms.length; i += 1) {
    if (pointInRoom(rooms[i], point)) return i;
  }
  return -1;
}

function collectWalkableInRoom(mask, room, trapIndex) {
  if (!room) return [];
  const cells = [];
  const startY = Math.max(0, room.y);
  const endY = Math.min(mask.length - 1, room.y + room.height - 1);
  const width = mask[0]?.length || 0;
  const startX = Math.max(0, room.x);
  const endX = Math.min(width - 1, room.x + room.width - 1);
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (!mask[y]?.[x]) continue;
      if (isTrapCell(trapIndex, x, y)) continue;
      cells.push({ x, y });
    }
  }
  return cells;
}

function comparePointAsc(a, b) {
  return (a.y - b.y) || (a.x - b.x);
}

function selectClosestToRoomCenter(cells, room) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const center = roomCenter(room);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const distance = manhattanDistance(cell, center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
      continue;
    }
    if (distance === bestDistance && best && comparePointAsc(cell, best) < 0) {
      best = cell;
    }
  }
  return best;
}

function selectBestExitCell(cells, spawn, { distances = null, minDistance = 0 } = {}) {
  if (!Array.isArray(cells) || cells.length === 0 || !spawn) return null;
  let best = null;
  let bestPathDistance = -1;
  let bestManhattan = -1;
  for (const cell of cells) {
    if (cell.x === spawn.x && cell.y === spawn.y) continue;
    const pathDistance = distances ? (distances[cell.y]?.[cell.x] ?? -1) : -1;
    if (distances && pathDistance < 0) continue;
    const distance = manhattanDistance(cell, spawn);
    if (distance < minDistance) continue;
    if (pathDistance > bestPathDistance) {
      bestPathDistance = pathDistance;
      bestManhattan = distance;
      best = cell;
      continue;
    }
    if (pathDistance === bestPathDistance) {
      if (distance > bestManhattan) {
        bestManhattan = distance;
        best = cell;
        continue;
      }
      if (distance === bestManhattan && best && comparePointAsc(cell, best) < 0) {
        best = cell;
      }
    }
  }
  return best;
}

function roomPairIsBetter(candidate, best) {
  if (!candidate) return false;
  if (!best) return true;
  if (candidate.totalDelta !== best.totalDelta) return candidate.totalDelta > best.totalDelta;
  if (candidate.minAxisDelta !== best.minAxisDelta) return candidate.minAxisDelta > best.minAxisDelta;
  if (candidate.maxAxisDelta !== best.maxAxisDelta) return candidate.maxAxisDelta > best.maxAxisDelta;
  if (candidate.entryCenter.x !== best.entryCenter.x) return candidate.entryCenter.x < best.entryCenter.x;
  if (candidate.entryCenter.y !== best.entryCenter.y) return candidate.entryCenter.y < best.entryCenter.y;
  if (candidate.exitCenter.x !== best.exitCenter.x) return candidate.exitCenter.x < best.exitCenter.x;
  if (candidate.exitCenter.y !== best.exitCenter.y) return candidate.exitCenter.y < best.exitCenter.y;
  if (candidate.entryIndex !== best.entryIndex) return candidate.entryIndex < best.entryIndex;
  return candidate.exitIndex < best.exitIndex;
}

function pickRoomPairWithGreatestDeltas(rooms, roomWalkable) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  const viable = rooms
    .map((room, index) => ({ room, index, center: roomCenter(room) }))
    .filter((entry) => Array.isArray(roomWalkable[entry.index]) && roomWalkable[entry.index].length > 0);
  if (viable.length === 0) return null;
  if (viable.length === 1) {
    return { entryIndex: viable[0].index, exitIndex: viable[0].index };
  }

  let best = null;
  for (let i = 0; i < viable.length - 1; i += 1) {
    for (let j = i + 1; j < viable.length; j += 1) {
      const a = viable[i];
      const b = viable[j];
      const dx = Math.abs(a.center.x - b.center.x);
      const dy = Math.abs(a.center.y - b.center.y);
      const aBeforeB = (a.center.x < b.center.x) || (a.center.x === b.center.x && a.center.y <= b.center.y);
      const entry = aBeforeB ? a : b;
      const exit = aBeforeB ? b : a;
      const candidate = {
        entryIndex: entry.index,
        exitIndex: exit.index,
        totalDelta: dx + dy,
        minAxisDelta: Math.min(dx, dy),
        maxAxisDelta: Math.max(dx, dy),
        entryCenter: entry.center,
        exitCenter: exit.center,
      };
      if (roomPairIsBetter(candidate, best)) {
        best = candidate;
      }
    }
  }
  if (!best) return null;
  return {
    entryIndex: best.entryIndex,
    exitIndex: best.exitIndex,
  };
}

function pickSpawnExitFromRooms(mask, levelGen, trapIndex, rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  const roomWalkable = rooms.map((room) => collectWalkableInRoom(mask, room, trapIndex));
  const pair = pickRoomPairWithGreatestDeltas(rooms, roomWalkable);
  if (!pair) return null;

  const entryRoom = rooms[pair.entryIndex];
  const exitRoom = rooms[pair.exitIndex];
  const entryCells = roomWalkable[pair.entryIndex] || [];
  const exitCells = roomWalkable[pair.exitIndex] || [];
  const spawn = selectClosestToRoomCenter(entryCells, entryRoom);
  if (!spawn) return null;

  const requirePath = Boolean(levelGen.connectivity?.requirePath);
  const distances = requirePath ? distanceFrom(mask, spawn) : null;
  const minDistance = Math.max(levelGen.spawn.minDistance || 0, levelGen.exit.minDistance || 0);
  let exit = selectBestExitCell(exitCells, spawn, { distances, minDistance });
  if (!exit && pair.entryIndex === pair.exitIndex) {
    exit = selectBestExitCell(entryCells, spawn, { distances, minDistance });
  }

  return {
    spawn,
    exit,
    entryRoomIndex: pair.entryIndex,
    exitRoomIndex: pair.exitIndex,
    entryRoomId: roomIdAt(entryRoom, pair.entryIndex),
    exitRoomId: roomIdAt(exitRoom, pair.exitIndex),
  };
}

function pickSpawn(mask, levelGen, rng, trapIndex) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const cells = collectWalkable(mask, trapIndex);
  const fallbackCells = cells.length ? cells : collectWalkable(mask, null);
  const spawnCandidates = filterEdgeCandidates(cells, width, height, levelGen.spawn.edgeBias);
  return pickCandidate(spawnCandidates, rng) || cells[0] || fallbackCells[0] || { x: 0, y: 0 };
}

function pickExit(mask, levelGen, rng, trapIndex, spawn) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const cells = collectWalkable(mask, trapIndex);
  const fallbackCells = cells.length ? cells : collectWalkable(mask, null);
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

  return pickCandidate(exitCandidates, rng) || pickFarthest(baseCandidates, distances) || spawn;
}

function resolveCorridorWidth(levelGen) {
  if (Number.isInteger(levelGen?.shape?.corridorWidth) && levelGen.shape.corridorWidth > 0) {
    return levelGen.shape.corridorWidth;
  }
  return DEFAULT_CORRIDOR_WIDTH;
}

function labelWalkableComponents(mask) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const labels = createNumberGrid(width, height, -1);
  const anchors = [];
  let componentCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y][x] || labels[y][x] >= 0) continue;
      labels[y][x] = componentCount;
      anchors.push({ x, y });
      const queue = [{ x, y }];
      let head = 0;
      while (head < queue.length) {
        const current = queue[head];
        head += 1;
        for (const delta of NEIGHBORS) {
          const nx = current.x + delta.dx;
          const ny = current.y + delta.dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (!mask[ny][nx]) continue;
          if (labels[ny][nx] >= 0) continue;
          labels[ny][nx] = componentCount;
          queue.push({ x: nx, y: ny });
        }
      }
      componentCount += 1;
    }
  }
  return { labels, anchors, componentCount };
}

function findInteriorPath({ start, end, width, height, blockedIndex }) {
  const startKey = `${start.x},${start.y}`;
  const endKey = `${end.x},${end.y}`;
  if (startKey === endKey) return [{ x: start.x, y: start.y }];

  const queue = [{ x: start.x, y: start.y }];
  const visited = new Set([startKey]);
  const previous = new Map();
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const delta of NEIGHBORS) {
      const nx = current.x + delta.dx;
      const ny = current.y + delta.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!isInteriorCell(nx, ny, width, height)) continue;
      const key = `${nx},${ny}`;
      if (blockedIndex?.has(key) || visited.has(key)) continue;
      visited.add(key);
      previous.set(key, { x: current.x, y: current.y });
      if (key === endKey) {
        head = queue.length;
        break;
      }
      queue.push({ x: nx, y: ny });
    }
  }

  if (!visited.has(endKey)) {
    return null;
  }

  const path = [];
  let cursor = { x: end.x, y: end.y };
  let cursorKey = endKey;
  while (cursor) {
    path.push(cursor);
    if (cursorKey === startKey) break;
    const parent = previous.get(cursorKey);
    if (!parent) return null;
    cursor = { x: parent.x, y: parent.y };
    cursorKey = `${cursor.x},${cursor.y}`;
  }
  path.reverse();
  return path;
}

function carvePath(mask, path, corridorWidth, blockedIndex = null) {
  if (!Array.isArray(path) || path.length === 0) return;
  for (const point of path) {
    carveCell(mask, point.x, point.y, corridorWidth, blockedIndex);
  }
}

function ensureConnectedToSpawn(mask, spawn, corridorWidth, blockedIndex = null) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  if (!mask[spawn.y]?.[spawn.x]) {
    return;
  }

  const maxAttempts = Math.max(1, width * height);
  let attempts = 0;
  while (attempts < maxAttempts) {
    const components = labelWalkableComponents(mask);
    if (components.componentCount <= 1) {
      return;
    }
    const spawnComponent = components.labels[spawn.y]?.[spawn.x];
    if (!Number.isInteger(spawnComponent) || spawnComponent < 0) {
      return;
    }

    let targetAnchor = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let id = 0; id < components.anchors.length; id += 1) {
      if (id === spawnComponent) continue;
      const anchor = components.anchors[id];
      const distance = manhattanDistance(spawn, anchor);
      if (
        distance < bestDistance
        || (
          distance === bestDistance
          && targetAnchor
          && (anchor.y < targetAnchor.y || (anchor.y === targetAnchor.y && anchor.x < targetAnchor.x))
        )
        || (distance === bestDistance && !targetAnchor)
      ) {
        bestDistance = distance;
        targetAnchor = anchor;
      }
    }
    if (!targetAnchor) {
      return;
    }

    const path = findInteriorPath({
      start: spawn,
      end: targetAnchor,
      width,
      height,
      blockedIndex,
    });
    if (!path || path.length === 0) {
      return;
    }
    carvePath(mask, path, corridorWidth, blockedIndex);
    attempts += 1;
  }
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
  const settings = readRoomSettings(levelGen);
  const rooms = placeRooms(mask, rng, settings);
  applyOrganicEdgePerturbation(mask, rng);
  ensureRoomsConnected(mask, rooms, rng, settings.corridorWidth);
  applyPatternOverlay(mask, rooms, levelGen);
  ensureWalkable(mask);
  return { mask, rooms };
}

export function generateGridLayout(levelGen) {
  const seed = Number.isFinite(levelGen.seed) ? levelGen.seed : 0;
  const rng = createRng(seed);
  const { mask, rooms } = generateMask(levelGen, rng);
  const traps = Array.isArray(levelGen.traps) ? levelGen.traps : [];
  applyTrapBlocking(mask, traps);
  const blockingTrapIndex = buildBlockingTrapIndex(traps);
  const walkableTilesTarget = resolveWalkableTilesTarget(levelGen);
  const requiresConnectedWalkable = Boolean(levelGen.connectivity?.requirePath);
  const corridorWidth = resolveCorridorWidth(levelGen);

  ensureWalkable(mask);
  const trapIndex = buildTrapIndex(traps);

  let spawn = null;
  if (requiresConnectedWalkable) {
    spawn = pickSpawn(mask, levelGen, rng, trapIndex);
    // When an explicit walkable target is set, connected reconciliation will build
    // a single connected component from spawn. Avoid the expensive pre-pass.
    if (!walkableTilesTarget) {
      ensureConnectedToSpawn(mask, spawn, corridorWidth, blockingTrapIndex);
    }
  }

  const currentWalkableTiles = countWalkableMask(mask);

  if (walkableTilesTarget && currentWalkableTiles !== walkableTilesTarget) {
    reconcileWalkableTiles({
      mask,
      targetWalkableTiles: walkableTilesTarget,
      blockedIndex: blockingTrapIndex,
      requireConnected: requiresConnectedWalkable,
      anchor: spawn,
      preserve: spawn ? [spawn] : [],
    });
  }
  if (requiresConnectedWalkable && spawn && mask[spawn.y]?.[spawn.x]) {
    ensureConnectedToSpawn(mask, spawn, corridorWidth, blockingTrapIndex);
  }

  ensureWalkable(mask);
  const roomPlacement = pickSpawnExitFromRooms(mask, levelGen, trapIndex, rooms);
  if (roomPlacement?.spawn) {
    spawn = roomPlacement.spawn;
  }
  if (!spawn || !mask[spawn.y]?.[spawn.x] || isTrapCell(trapIndex, spawn.x, spawn.y)) {
    spawn = pickSpawn(mask, levelGen, rng, trapIndex);
  }

  let exit = roomPlacement?.exit || null;
  if (
    !exit
    || (exit.x === spawn.x && exit.y === spawn.y)
    || !mask[exit.y]?.[exit.x]
    || isTrapCell(trapIndex, exit.x, exit.y)
  ) {
    exit = pickExit(mask, levelGen, rng, trapIndex, spawn);
  }
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
    const entryRoomIndex = roomPlacement?.entryRoomIndex ?? findRoomIndexForPoint(rooms, spawn);
    if (Number.isInteger(entryRoomIndex) && entryRoomIndex >= 0) {
      layout.entryRoomId = roomIdAt(rooms[entryRoomIndex], entryRoomIndex);
    }
    const exitRoomIndex = roomPlacement?.exitRoomIndex ?? findRoomIndexForPoint(rooms, exit);
    if (Number.isInteger(exitRoomIndex) && exitRoomIndex >= 0) {
      layout.exitRoomId = roomIdAt(rooms[exitRoomIndex], exitRoomIndex);
    }
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

function countLayoutWalkableTiles(layout) {
  if (!Array.isArray(layout?.tiles)) return 0;
  let count = 0;
  for (let y = 0; y < layout.tiles.length; y += 1) {
    const row = String(layout.tiles[y] || "");
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== "#") count += 1;
    }
  }
  return count;
}

export function generateGridLayoutFromInput(input) {
  const normalized = normalizeLevelGenInput(input);
  if (!normalized.ok) {
    return normalized;
  }
  const layout = generateGridLayout(normalized.value);
  const walkableTilesTarget = resolveWalkableTilesTarget(normalized.value);
  if (walkableTilesTarget !== null) {
    const walkableTiles = countLayoutWalkableTiles(layout);
    if (walkableTiles !== walkableTilesTarget) {
      return {
        ok: false,
        errors: [
          {
            field: "walkableTilesTarget",
            code: "target_mismatch",
            detail: { target: walkableTilesTarget, walkableTiles },
          },
        ],
        warnings: normalized.warnings,
        value: null,
      };
    }
  }
  return {
    ok: true,
    errors: [],
    warnings: normalized.warnings,
    value: layout,
  };
}
