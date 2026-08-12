import { normalizeLevelGenInput } from "./level-gen.js";
import { LEVEL_GEN_DEFAULTS } from "./defaults.js";

const DEFAULT_ROOM_COUNT = 4;
const DEFAULT_ROOM_MIN_SIZE = 3;
const DEFAULT_ROOM_MAX_SIZE = 9;
const DEFAULT_CORRIDOR_WIDTH = 1;
const ROOM_PLACEMENT_PADDING = 1;
const ROOM_PLACEMENT_ATTEMPTS = 40;
const ROOM_SURFACE_PLACEMENT_ATTEMPTS = 12;
const TARGET_ROOM_WALKABLE_SHARE = 0.85;
// Smallest number of walkable tiles a declared room needs to hold a distinct
// entrance point, an exit/passage point, and at least one connective/standing
// tile — independent of the room's footprint size (small/medium/large all
// place a room capable of holding this many tiles; see I4 minimum-viable-
// interior rejection in generateGridLayoutFromInput).
const MIN_VIABLE_ROOM_INTERIOR_TILES = 3;

const KIND_STATIONARY = 0;
const KIND_BARRIER = 1;
const KIND_HAZARD = 2;

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

function shuffleInPlace(list, rng) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    if (i === j) continue;
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
}

function randomIntTowardMax(rng, min, max) {
  if (max <= min) return min;
  const range = (max - min) + 1;
  const roll = Math.max(rng(), rng());
  return min + Math.floor(roll * range);
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
  preserve = [],
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

  // Preserved positions (e.g. hazard tiles) are force-selected below as extra
  // BFS seeds, but a multi-source frontier expansion does not guarantee the
  // final selection is one connected region — the anchor's growing frontier
  // can hit `target` before ever reaching a distant preserved cell, leaving
  // it selected but isolated. Walk the mask as it stands now (still fully
  // carved for any room, since this runs before pruning) to find an
  // already-walkable path from the anchor to each preserved cell, and fold
  // that path into `preserve` so the budget accounting and BFS below treat
  // it as already-connected floor. Only existing walkable cells are used, so
  // this can never carve floor outside a room's carved interior.
  const findWalkablePath = (start, end) => {
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
      const currentKey = `${current.x},${current.y}`;
      if (currentKey === endKey) break;
      for (const delta of NEIGHBORS) {
        const nx = current.x + delta.dx;
        const ny = current.y + delta.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!mask[ny]?.[nx]) continue;
        if (!isEligible(nx, ny)) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        previous.set(key, current);
        queue.push({ x: nx, y: ny });
      }
    }
    if (!visited.has(endKey)) return null;
    const path = [];
    let cursor = { x: end.x, y: end.y };
    let cursorKey = endKey;
    while (cursor) {
      path.push(cursor);
      if (cursorKey === startKey) break;
      const parent = previous.get(cursorKey);
      if (!parent) return null;
      cursor = parent;
      cursorKey = `${cursor.x},${cursor.y}`;
    }
    path.reverse();
    return path;
  };

  // preserve entries are processed in priority order — earlier entries (e.g.
  // spawn, hazard positions passed in by the caller) are never dropped even if
  // budget is tight; later entries (e.g. I4's soft multi-room anchors, added
  // after the caller's required preserve list) are truncated first if the
  // fully path-folded preserve set would exceed `target`, so a tight budget
  // degrades multi-room coverage gracefully instead of silently overshooting
  // the exact-total contract enforced by generateGridLayoutFromInput.
  // findWalkablePath returns anchor-first, so keeping only a connected
  // prefix of a path (rather than all-or-nothing) still leaves every
  // pre-selected cell reachable from the anchor — it just means the path
  // stops short of a low-priority point instead of jumping straight to an
  // unreachable orphan.
  const preserveWithPaths = [];
  const seenPreserve = new Set();
  let preserveBudget = target;
  const pushWithinBudget = (points) => {
    for (const point of points) {
      if (preserveBudget <= 0) return;
      const key = `${point.x},${point.y}`;
      if (seenPreserve.has(key)) continue;
      seenPreserve.add(key);
      preserveWithPaths.push(point);
      preserveBudget -= 1;
    }
  };
  for (const pos of preserve) {
    if (!pos || !isEligible(pos.x, pos.y) || preserveBudget <= 0) continue;
    if (pos.x === anchorCell.x && pos.y === anchorCell.y) {
      pushWithinBudget([pos]);
      continue;
    }
    const path = findWalkablePath(anchorCell, pos);
    if (Array.isArray(path)) {
      // path[0] is the anchor itself; walking it in order keeps every
      // pushed cell connected to the anchor even if we run out of budget
      // before reaching `pos`.
      pushWithinBudget(path);
    } else {
      pushWithinBudget([pos]);
    }
  }
  preserve = preserveWithPaths;

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

  // Pre-select preserved positions so they count toward the target budget.
  // Force them walkable and seed the BFS queue so their neighbors are explored.
  let preSelectedCount = 0;
  for (const pos of preserve) {
    if (!pos || !isEligible(pos.x, pos.y)) continue;
    mask[pos.y][pos.x] = true;
    const pi = toIndex(pos.x, pos.y);
    if (!selected[pi]) {
      selected[pi] = 1;
      preSelectedCount += 1;
    }
    if (!queuedWalkable[pi]) {
      queuedWalkable[pi] = 1;
      walkableQueue.push(pi);
    }
  }

  tryQueueWalkable(anchorCell.x, anchorCell.y);
  let walkableHead = 0;
  let selectedCount = preSelectedCount;

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
      preserve: Array.isArray(preserve) ? preserve : [],
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
  const baseSettings = {
    roomCount,
    roomMinSize,
    roomMaxSize,
    corridorWidth,
    roomPadding: ROOM_PLACEMENT_PADDING,
    preferLargeRooms: false,
    preferIrregular: true,
  };
  if (walkableTilesTarget === null) {
    return baseSettings;
  }
  const interiorCapacity = countWalkableCapacity(createMask(width, height, false));
  if (interiorCapacity <= 0) {
    return baseSettings;
  }
  const normalizedWalkableTarget = Math.min(walkableTilesTarget, interiorCapacity);
  const desiredRoomTiles = Math.max(1, Math.round(normalizedWalkableTarget * TARGET_ROOM_WALKABLE_SHARE));
  const maxRoomArea = Math.max(1, roomMaxSize * roomMaxSize);
  const targetRoomCount = clampInt(
    Math.ceil(desiredRoomTiles / maxRoomArea),
    1,
    maxRooms,
  );
  const adjustedRoomCount = Math.max(roomCount, targetRoomCount);
  const desiredRoomAreaPerRoom = Math.max(1, Math.ceil(desiredRoomTiles / adjustedRoomCount));
  const desiredRoomSide = clampInt(
    Math.ceil(Math.sqrt(desiredRoomAreaPerRoom)),
    roomMinSize,
    roomMaxSize,
  );
  const adjustedRoomMinSize = clampInt(
    Math.max(roomMinSize, desiredRoomSide - 1),
    1,
    roomMaxSize,
  );
  const targetDensity = desiredRoomTiles / interiorCapacity;
  return {
    roomCount: adjustedRoomCount,
    roomMinSize: adjustedRoomMinSize,
    roomMaxSize,
    corridorWidth,
    roomPadding: targetDensity > 0.62 ? 0 : ROOM_PLACEMENT_PADDING,
    preferLargeRooms: true,
    preferIrregular: true,
    // With an explicit floorTile budget every corridor tile is paid for out
    // of the walkable target (see distributeWalkableTilesAcrossRooms), so
    // rooms are placed compactly around the grid center instead of being
    // spread across the surface — long corridors would silently eat the
    // budget that authored content (hazards, actors) needs as room floor.
    compactPlacement: true,
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

function resolveInteriorBounds(width, height) {
  if (hasBorder(width, height)) {
    return {
      minX: 1,
      minY: 1,
      maxX: Math.max(1, width - 2),
      maxY: Math.max(1, height - 2),
    };
  }
  return {
    minX: 0,
    minY: 0,
    maxX: Math.max(0, width - 1),
    maxY: Math.max(0, height - 1),
  };
}

function randomRoomSize(rng, min, max, preferLargeRooms = false) {
  return preferLargeRooms
    ? randomIntTowardMax(rng, min, max)
    : randomIntBetween(rng, min, max);
}

/**
 * Return { width, height } where the longer dimension is always >= 1.5× the shorter.
 * When the range is too tight to satisfy the ratio, falls back to { width: min, height: max }.
 * @param {() => number} rng  - RNG returning [0, 1)
 * @param {number} min        - minimum dimension (inclusive)
 * @param {number} max        - maximum dimension (inclusive)
 * @returns {{ width: number, height: number }}
 */
export function randomIrregularRoomDimensions(rng, min, max) {
  const maxShort = Math.floor(max / 1.5);
  if (maxShort < min) {
    // Range too tight to guarantee 1.5 ratio — return the widest valid rectangle
    const wide = rng() < 0.5;
    return wide ? { width: max, height: min } : { width: min, height: max };
  }
  const short = randomIntBetween(rng, min, maxShort);
  const minLong = Math.ceil(short * 1.5);
  const long = randomIntBetween(rng, minLong, max);
  const wide = rng() < 0.5;
  return wide ? { width: long, height: short } : { width: short, height: long };
}

function buildRoomSurfaceSlots(width, height, roomCount) {
  const slots = [];
  if (!Number.isInteger(roomCount) || roomCount <= 0) return slots;
  const bounds = resolveInteriorBounds(width, height);
  const interiorWidth = (bounds.maxX - bounds.minX) + 1;
  const interiorHeight = (bounds.maxY - bounds.minY) + 1;
  if (interiorWidth <= 0 || interiorHeight <= 0) return slots;

  const aspectRatio = interiorWidth / Math.max(1, interiorHeight);
  const columns = clampInt(Math.ceil(Math.sqrt(roomCount * aspectRatio)), 1, roomCount);
  const rows = Math.max(1, Math.ceil(roomCount / columns));

  for (let row = 0; row < rows; row += 1) {
    const startY = bounds.minY + Math.floor((row * interiorHeight) / rows);
    const endY = bounds.minY + Math.floor(((row + 1) * interiorHeight) / rows) - 1;
    if (endY < startY) continue;
    for (let column = 0; column < columns; column += 1) {
      const startX = bounds.minX + Math.floor((column * interiorWidth) / columns);
      const endX = bounds.minX + Math.floor(((column + 1) * interiorWidth) / columns) - 1;
      if (endX < startX) continue;
      slots.push({
        startX,
        startY,
        endX,
        endY,
      });
    }
  }
  return slots;
}

function placeRoomInSlot(mask, slot, roomId, rng, settings) {
  const slotWidth = (slot.endX - slot.startX) + 1;
  const slotHeight = (slot.endY - slot.startY) + 1;
  if (slotWidth <= 0 || slotHeight <= 0) return null;

  const roomMinWidth = Math.min(settings.roomMinSize, slotWidth);
  const roomMinHeight = Math.min(settings.roomMinSize, slotHeight);
  const roomMaxWidth = Math.min(settings.roomMaxSize, slotWidth);
  const roomMaxHeight = Math.min(settings.roomMaxSize, slotHeight);
  if (roomMaxWidth <= 0 || roomMaxHeight <= 0) return null;

  for (let attempt = 0; attempt < ROOM_SURFACE_PLACEMENT_ATTEMPTS; attempt += 1) {
    let roomWidth, roomHeight;
    if (settings.preferIrregular) {
      const effMin = Math.min(roomMinWidth, roomMinHeight);
      const effMax = Math.min(roomMaxWidth, roomMaxHeight);
      const dims = randomIrregularRoomDimensions(rng, effMin, effMax);
      roomWidth = Math.min(dims.width, roomMaxWidth);
      roomHeight = Math.min(dims.height, roomMaxHeight);
    } else {
      roomWidth = randomRoomSize(rng, roomMinWidth, roomMaxWidth, settings.preferLargeRooms);
      roomHeight = randomRoomSize(rng, roomMinHeight, roomMaxHeight, settings.preferLargeRooms);
    }
    const maxX = slot.endX - roomWidth + 1;
    const maxY = slot.endY - roomHeight + 1;
    if (maxX < slot.startX || maxY < slot.startY) continue;
    let roomX;
    let roomY;
    if (settings.compactPlacement) {
      // Compact mode (explicit floorTile budget): hug the grid center within
      // the slot so inter-room corridors stay as short as possible — every
      // corridor tile is paid for out of the walkable budget. The clamp is
      // inset by roomPadding so rooms in adjacent slots keep the required
      // gap instead of colliding at the shared slot boundary (which would
      // punt them to random fallback placement).
      const pad = settings.roomPadding ?? 0;
      const centerX = Math.floor((mask[0].length - roomWidth) / 2);
      const centerY = Math.floor((mask.length - roomHeight) / 2);
      const loX = Math.min(slot.startX + pad, maxX);
      const hiX = Math.max(maxX - pad, slot.startX);
      const loY = Math.min(slot.startY + pad, maxY);
      const hiY = Math.max(maxY - pad, slot.startY);
      roomX = clampInt(centerX, Math.min(loX, hiX), Math.max(loX, hiX));
      roomY = clampInt(centerY, Math.min(loY, hiY), Math.max(loY, hiY));
    } else {
      roomX = randomIntBetween(rng, slot.startX, maxX);
      roomY = randomIntBetween(rng, slot.startY, maxY);
    }
    const room = {
      id: `R${roomId}`,
      x: roomX,
      y: roomY,
      width: roomWidth,
      height: roomHeight,
    };
    if (!canPlaceRoom(mask, room, settings.roomPadding)) continue;
    carveRoom(mask, room);
    return room;
  }

  return null;
}

function placeRooms(mask, rng, settings) {
  const rooms = [];
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const {
    roomCount,
    roomMinSize,
    roomMaxSize,
    roomPadding = ROOM_PLACEMENT_PADDING,
    preferLargeRooms = false,
    preferIrregular = true,
    compactPlacement = false,
  } = settings;
  const bounds = resolveInteriorBounds(width, height);

  const slots = buildRoomSurfaceSlots(width, height, roomCount);
  if (compactPlacement) {
    // Deterministic centermost-first ordering: with an explicit floorTile
    // budget, rooms cluster around the grid center so the connectivity
    // backbone (paid out of the budget) stays short. Ties break by slot
    // position for reproducibility.
    const centerX = width / 2;
    const centerY = height / 2;
    const slotDistance = (slot) => (
      Math.abs(((slot.startX + slot.endX) / 2) - centerX)
      + Math.abs(((slot.startY + slot.endY) / 2) - centerY)
    );
    slots.sort((a, b) => (
      (slotDistance(a) - slotDistance(b))
      || (a.startY - b.startY)
      || (a.startX - b.startX)
    ));
  } else {
    shuffleInPlace(slots, rng);
  }
  for (let i = 0; i < slots.length && rooms.length < roomCount; i += 1) {
    const room = placeRoomInSlot(mask, slots[i], rooms.length + 1, rng, {
      roomMinSize,
      roomMaxSize,
      roomPadding,
      preferLargeRooms,
      preferIrregular,
      compactPlacement,
    });
    if (!room) continue;
    rooms.push(room);
  }

  const maxAttempts = Math.max(roomCount * ROOM_PLACEMENT_ATTEMPTS, ROOM_PLACEMENT_ATTEMPTS);

  let attempts = 0;
  while (rooms.length < roomCount && attempts < maxAttempts) {
    let roomWidth, roomHeight;
    if (preferIrregular) {
      const dims = randomIrregularRoomDimensions(rng, roomMinSize, roomMaxSize);
      roomWidth = dims.width;
      roomHeight = dims.height;
    } else {
      roomWidth = randomRoomSize(rng, roomMinSize, roomMaxSize, preferLargeRooms);
      roomHeight = randomRoomSize(rng, roomMinSize, roomMaxSize, preferLargeRooms);
    }
    const maxX = bounds.maxX - roomWidth + 1;
    const maxY = bounds.maxY - roomHeight + 1;
    if (maxX < bounds.minX || maxY < bounds.minY) {
      attempts += 1;
      continue;
    }
    const room = {
      id: `R${rooms.length + 1}`,
      x: randomIntBetween(rng, bounds.minX, maxX),
      y: randomIntBetween(rng, bounds.minY, maxY),
      width: roomWidth,
      height: roomHeight,
    };
    if (canPlaceRoom(mask, room, roomPadding)) {
      carveRoom(mask, room);
      rooms.push(room);
    }
    attempts += 1;
  }

  if (rooms.length < roomCount) {
    const maxScanY = bounds.maxY - roomMinSize + 1;
    const maxScanX = bounds.maxX - roomMinSize + 1;
    for (let y = bounds.minY; y <= maxScanY && rooms.length < roomCount; y += 1) {
      for (let x = bounds.minX; x <= maxScanX && rooms.length < roomCount; x += 1) {
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
  if (typeof rawPattern !== "string") return LEVEL_PATTERN_TYPES.none;
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
  return LEVEL_PATTERN_TYPES.none;
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

function buildHazardIndex(hazards = []) {
  const index = new Set();
  for (const hazard of hazards) {
    if (!hazard) continue;
    index.add(`${hazard.x},${hazard.y}`);
  }
  return index;
}

function buildBlockingHazardIndex(hazards = []) {
  const index = new Set();
  for (const hazard of hazards) {
    if (!hazard?.blocking) continue;
    index.add(`${hazard.x},${hazard.y}`);
  }
  return index;
}

function isHazardCell(hazardIndex, x, y) {
  if (!hazardIndex) return false;
  return hazardIndex.has(`${x},${y}`);
}

// Authored hazard x/y are room-relative (offsets into a target room's carved
// interior), not absolute grid coordinates. Spec strings carry no room field,
// so room assignment uses the simplest deterministic rule available: every
// hazard maps into the FIRST declared room (rooms[0], i.e. room declaration
// order), matching how a single-room level already behaves and keeping
// multi-room placement predictable for a given input+seed. When no rooms
// exist (e.g. roomless/legacy callers), coordinates are treated as absolute,
// preserving prior behavior for that case.
// Returns { mapped, errors } — errors are structured {field, code, detail}
// entries for coordinates that exceed the target room's interior bounds.
function mapHazardsToRooms(hazards = [], rooms = []) {
  if (!Array.isArray(hazards) || hazards.length === 0) {
    return { mapped: [], errors: [] };
  }
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return { mapped: hazards.map((hazard) => ({ ...hazard })), errors: [] };
  }
  const targetRoom = rooms[0];
  const errors = [];
  const mapped = hazards.map((hazard, idx) => {
    const relX = hazard.x;
    const relY = hazard.y;
    if (relX < 0 || relY < 0 || relX >= targetRoom.width || relY >= targetRoom.height) {
      errors.push({
        field: `hazards[${idx}].position`,
        code: "hazard_outside_room",
        detail: {
          x: relX,
          y: relY,
          roomId: roomIdAt(targetRoom, 0),
          roomWidth: targetRoom.width,
          roomHeight: targetRoom.height,
        },
      });
      return hazard;
    }
    return {
      ...hazard,
      x: targetRoom.x + relX,
      y: targetRoom.y + relY,
    };
  });
  return { mapped, errors };
}

function applyHazardBlocking(mask, hazards = []) {
  for (const hazard of hazards) {
    if (!hazard?.blocking) continue;
    if (mask[hazard.y] && typeof mask[hazard.y][hazard.x] === "boolean") {
      mask[hazard.y][hazard.x] = false;
    }
  }
}

function collectWalkable(mask, hazardIndex) {
  const cells = [];
  for (let y = 0; y < mask.length; y += 1) {
    for (let x = 0; x < mask[y].length; x += 1) {
      if (mask[y][x] && !isHazardCell(hazardIndex, x, y)) {
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

function collectWalkableInRoom(mask, room, hazardIndex) {
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
      if (isHazardCell(hazardIndex, x, y)) continue;
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

// I4 fix: when a create request declares multiple rooms plus a floorTile
// budget (walkableTilesTarget), the budget is DISTRIBUTED across every
// declared room instead of acting as a single global carve cap (which
// previously let one room drain the whole budget while later rooms stayed
// declared + billed but 100% wall — see
// tests/integration/create-multi-room-carving.test.js).
//
// Distribution rule (deterministic, O(grid area) overall — this also runs at
// 550k-walkable-tile scale, so no per-room flood fills over the whole grid
// and no string-keyed sets on hot paths):
//   1. Connectivity backbone first: rooms are chained in room-center order
//      (x, then y — the same order corridor carving uses) and each
//      consecutive pair is joined door-to-door with an L-shaped path (BFS
//      fallback over eligible cells only when the straight path is blocked).
//      Like the reconcile expansion phase, the backbone may carve eligible
//      wall cells, so it takes the shortest connection rather than paying
//      for a detour through pre-carved corridors. Non-blocking hazard
//      positions are tethered to the backbone inside their room (M3
//      contract). Backbone pieces inside one room are linked by an in-room
//      BFS so the whole backbone is one connected component.
//   2. Every room is guaranteed MIN_VIABLE_ROOM_INTERIOR_TILES of floor;
//      backbone cells inside a room count toward that minimum, so only the
//      shortfall is reserved. The rest of the budget is split evenly:
//      floor(distributable / roomCount) each, remainder to earliest rooms.
//      Shares grow by BFS inside each room from its backbone cells.
//   3. A room too small to absorb its share spills the leftover to the next
//      rooms; any final leftover fills connected eligible cells anywhere via
//      one global BFS, so the total always equals walkableTilesTarget and
//      the target_mismatch contract in generateGridLayoutFromInput holds.
//
// Returns { ok: true } after mutating mask in place, or
// { ok: false, error } when the budget cannot cover the backbone plus a
// minimum viable interior per room (the caller rejects with a structured
// floor_tile_budget_insufficient error instead of silently under-carving).
function distributeWalkableTilesAcrossRooms({
  mask,
  targetWalkableTiles,
  rooms,
  blockedIndex = null,
  hazardIndex = null,
  preserve = [],
} = {}) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  if (width <= 0 || !Array.isArray(rooms) || rooms.length < 2) return { ok: true };
  const area = width * height;
  const toIndex = (x, y) => (y * width) + x;

  // Blocked cells (blocking hazards) as a typed array — the index is tiny, but
  // eligibility is checked O(area) times and string keys would dominate.
  const blocked = new Uint8Array(area);
  if (blockedIndex) {
    for (const key of blockedIndex) {
      const [x, y] = String(key).split(",").map(Number);
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height) {
        blocked[toIndex(x, y)] = 1;
      }
    }
  }
  const isEligible = (x, y) => (
    isInteriorCell(x, y, width, height) && !blocked[toIndex(x, y)]
  );

  let capacity = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isEligible(x, y)) capacity += 1;
    }
  }
  const target = Math.min(targetWalkableTiles, capacity);
  if (target <= 0) return { ok: true };

  // Cell -> room lookup (rooms never overlap; later rooms win ties).
  const roomIdx = new Int32Array(area).fill(-1);
  rooms.forEach((room, i) => {
    const endY = Math.min(height, room.y + room.height);
    const endX = Math.min(width, room.x + room.width);
    for (let y = Math.max(0, room.y); y < endY; y += 1) {
      for (let x = Math.max(0, room.x); x < endX; x += 1) {
        roomIdx[toIndex(x, y)] = i;
      }
    }
  });

  const selected = new Uint8Array(area);
  let selectedCount = 0;
  const backboneInRoom = new Array(rooms.length).fill(0);
  const addCell = (x, y) => {
    if (!isEligible(x, y)) return;
    const idx = toIndex(x, y);
    if (selected[idx]) return;
    selected[idx] = 1;
    selectedCount += 1;
    const r = roomIdx[idx];
    if (r >= 0) backboneInRoom[r] += 1;
  };

  // BFS over eligible cells (walkable or not) from `sources` to the nearest
  // cell satisfying `isTarget`; used only as a fallback for blocked straight
  // paths and for small in-room links, so it stays off the hot path.
  const parent = new Int32Array(area);
  const visitedStamp = new Int32Array(area);
  let stamp = 0;
  const bfsPath = (sources, isTarget) => {
    stamp += 1;
    const queue = [];
    for (const source of sources) {
      if (!isEligible(source.x, source.y)) continue;
      const idx = toIndex(source.x, source.y);
      if (visitedStamp[idx] === stamp) continue;
      visitedStamp[idx] = stamp;
      parent[idx] = -1;
      if (isTarget(source.x, source.y)) return [{ x: source.x, y: source.y }];
      queue.push(idx);
    }
    let head = 0;
    let foundIdx = -1;
    while (head < queue.length && foundIdx < 0) {
      const currentIdx = queue[head];
      head += 1;
      const cx = currentIdx % width;
      const cy = (currentIdx - cx) / width;
      for (const delta of NEIGHBORS) {
        const nx = cx + delta.dx;
        const ny = cy + delta.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!isEligible(nx, ny)) continue;
        const nIdx = toIndex(nx, ny);
        if (visitedStamp[nIdx] === stamp) continue;
        visitedStamp[nIdx] = stamp;
        parent[nIdx] = currentIdx;
        if (isTarget(nx, ny)) {
          foundIdx = nIdx;
          break;
        }
        queue.push(nIdx);
      }
    }
    if (foundIdx < 0) return null;
    const path = [];
    let cursor = foundIdx;
    while (cursor >= 0) {
      const x = cursor % width;
      path.push({ x, y: (cursor - x) / width });
      cursor = parent[cursor];
    }
    path.reverse();
    return path;
  };

  // 1. Chain rooms in center order with door-to-door L-paths.
  const order = rooms
    .map((room, i) => ({ i, c: roomCenter(room) }))
    .sort((a, b) => (a.c.x - b.c.x) || (a.c.y - b.c.y) || (a.i - b.i));
  const clampToRoom = (room, point) => ({
    x: Math.min(room.x + room.width - 1, Math.max(room.x, point.x)),
    y: Math.min(room.y + room.height - 1, Math.max(room.y, point.y)),
  });
  const lPath = (from, to) => {
    const cells = [{ x: from.x, y: from.y }];
    let { x, y } = from;
    while (x !== to.x) {
      x += Math.sign(to.x - x);
      cells.push({ x, y });
    }
    while (y !== to.y) {
      y += Math.sign(to.y - y);
      cells.push({ x, y });
    }
    return cells;
  };

  // No standalone seed cell: the first door-to-door path below already puts
  // a backbone cell in the first room. Seeding its center as well would cost
  // the center cell plus an in-room link to the door — pure budget overhead
  // (enough to push tight-but-viable budgets like t2-stress into rejection).
  for (let k = 1; k < order.length; k += 1) {
    const roomA = rooms[order[k - 1].i];
    const roomB = rooms[order[k].i];
    const doorA = clampToRoom(roomA, roomCenter(roomB));
    const doorB = clampToRoom(roomB, doorA);
    let cells = lPath(doorA, doorB);
    if (cells.some((p) => !isEligible(p.x, p.y))) {
      cells = bfsPath([doorA], (x, y) => x === doorB.x && y === doorB.y)
        || cells.filter((p) => isEligible(p.x, p.y));
    }
    cells.forEach((p) => addCell(p.x, p.y));
  }

  // Tether preserved (non-blocking hazard) positions so M3's hazard contract
  // holds under distribution. The pre-reconciliation spawn is deliberately
  // NOT tethered: spawn is re-picked from the carved rooms afterwards
  // (pickSpawnExitFromRooms), so preserving the pre-pick would only burn
  // budget on a corridor to a soon-to-be-discarded cell.
  (Array.isArray(preserve) ? preserve : []).forEach((point) => {
    if (!point || !isEligible(point.x, point.y)) return;
    if (selected[toIndex(point.x, point.y)]) return;
    const path = bfsPath([point], (x, y) => selected[toIndex(x, y)] === 1);
    if (Array.isArray(path)) {
      path.forEach((p) => addCell(p.x, p.y));
    } else {
      addCell(point.x, point.y);
    }
  });

  // Link backbone pieces that landed in the same room (e.g. the doors of the
  // previous and next chain hop, or a hazard tether) with in-room paths so the
  // backbone stays one connected component. Rooms are small, so these BFS
  // runs are bounded by room area, not grid area.
  rooms.forEach((room) => {
    const pieces = [];
    const endY = Math.min(height, room.y + room.height);
    const endX = Math.min(width, room.x + room.width);
    for (let y = Math.max(0, room.y); y < endY; y += 1) {
      for (let x = Math.max(0, room.x); x < endX; x += 1) {
        if (selected[toIndex(x, y)]) pieces.push({ x, y });
      }
    }
    if (pieces.length < 2) return;
    const hub = pieces[0];
    for (let p = 1; p < pieces.length; p += 1) {
      const piece = pieces[p];
      if (Math.abs(piece.x - hub.x) + Math.abs(piece.y - hub.y) <= 1) continue;
      // bfsPath prefers in-room routes (they are shortest) but may route
      // around a blocked interior; either way every path cell joins the
      // backbone so the pieces end up connected.
      const path = bfsPath(
        [hub],
        (x, y) => x === piece.x && y === piece.y,
      );
      if (Array.isArray(path)) {
        path.forEach((point) => addCell(point.x, point.y));
      }
    }
  });

  // 2. Reject when the backbone plus a minimum viable interior per room
  //    cannot fit in the budget — no distribution could keep every declared
  //    room playable and connected. Backbone cells inside a room count
  //    toward that room's minimum, so only each room's shortfall is
  //    reserved.
  const backboneCount = selectedCount;
  const remaining = target - backboneCount;
  const minRequired = minimumViableFloorBudget(rooms.length);
  const roomShortfalls = backboneInRoom.map(
    (count) => Math.max(0, MIN_VIABLE_ROOM_INTERIOR_TILES - count),
  );
  const totalShortfall = roomShortfalls.reduce((sum, value) => sum + value, 0);
  if (target < minRequired || remaining < totalShortfall) {
    return {
      ok: false,
      error: {
        field: "floorTile.count",
        code: "floor_tile_budget_insufficient",
        detail: {
          target: targetWalkableTiles,
          roomCount: rooms.length,
          minPerRoom: MIN_VIABLE_ROOM_INTERIOR_TILES,
          required: Math.max(minRequired, backboneCount + totalShortfall),
          connectivityBackbone: backboneCount,
        },
      },
    };
  }

  // 3. Guaranteed minimum first, then even split of the rest, remainder to
  //    earliest rooms. Each share grows by BFS inside its room from the
  //    room's backbone cells; growth is bounded by room area.
  const distributable = remaining - totalShortfall;
  const base = Math.floor(distributable / rooms.length);
  let extra = distributable % rooms.length;
  let carry = 0;
  for (let i = 0; i < rooms.length; i += 1) {
    let share = roomShortfalls[i] + base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    share += carry;
    carry = 0;
    const room = rooms[i];
    const startY = Math.max(0, room.y);
    const startX = Math.max(0, room.x);
    const endY = Math.min(height, room.y + room.height);
    const endX = Math.min(width, room.x + room.width);
    const inRect = (x, y) => x >= startX && x < endX && y >= startY && y < endY;
    stamp += 1;
    const queue = [];
    // Grow only from cells already in the selected backbone — seeding an
    // unselected cell would grow a floating blob disconnected from it.
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const idx = toIndex(x, y);
        if (selected[idx] && visitedStamp[idx] !== stamp) {
          visitedStamp[idx] = stamp;
          queue.push(idx);
        }
      }
    }
    let added = 0;
    if (queue.length === 0) {
      // Pathologically unreachable room (eligible cells split by blocking
      // hazards): still give it floor rather than leaving it 100% wall — the
      // carve-every-room contract outranks connectivity in this corner. The
      // seed counts against the room's share so the exact total still holds.
      for (let y = startY; y < endY && queue.length === 0; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          if (!isEligible(x, y)) continue;
          addCell(x, y);
          added += 1;
          const idx = toIndex(x, y);
          visitedStamp[idx] = stamp;
          queue.push(idx);
          break;
        }
      }
    }
    let head = 0;
    while (head < queue.length && added < share) {
      const currentIdx = queue[head];
      head += 1;
      const cx = currentIdx % width;
      const cy = (currentIdx - cx) / width;
      for (const delta of NEIGHBORS) {
        const nx = cx + delta.dx;
        const ny = cy + delta.dy;
        if (!inRect(nx, ny) || !isEligible(nx, ny)) continue;
        const nIdx = toIndex(nx, ny);
        if (visitedStamp[nIdx] === stamp) continue;
        visitedStamp[nIdx] = stamp;
        if (!selected[nIdx]) {
          if (added >= share) continue;
          selected[nIdx] = 1;
          selectedCount += 1;
          added += 1;
        }
        queue.push(nIdx);
      }
    }
    carry = share - added;
  }

  // 4. One global connected fill for any leftover, so the exact-total
  //    contract always holds when capacity allows. Single BFS over eligible
  //    cells seeded from the whole selection — O(area).
  if (selectedCount < target) {
    stamp += 1;
    const queue = [];
    for (let idx = 0; idx < area; idx += 1) {
      if (selected[idx]) {
        visitedStamp[idx] = stamp;
        queue.push(idx);
      }
    }
    let head = 0;
    while (head < queue.length && selectedCount < target) {
      const currentIdx = queue[head];
      head += 1;
      const cx = currentIdx % width;
      const cy = (currentIdx - cx) / width;
      for (const delta of NEIGHBORS) {
        const nx = cx + delta.dx;
        const ny = cy + delta.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!isEligible(nx, ny)) continue;
        const nIdx = toIndex(nx, ny);
        if (visitedStamp[nIdx] === stamp) continue;
        visitedStamp[nIdx] = stamp;
        if (selectedCount < target && !selected[nIdx]) {
          selected[nIdx] = 1;
          selectedCount += 1;
        }
        queue.push(nIdx);
      }
    }
  }

  // 5. Write the selection back: eligible cells are walkable iff selected.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isEligible(x, y)) continue;
      mask[y][x] = selected[toIndex(x, y)] === 1;
    }
  }
  return { ok: true };
}

// Minimum floorTile budget required to give every declared room at least
// MIN_VIABLE_ROOM_INTERIOR_TILES walkable tiles (entrance + exit + one
// connective/standing tile). Below this, no distribution can carve every
// declared room without leaving one below a playable minimum, so the request
// must be rejected with a structured error rather than silently under-carved.
function minimumViableFloorBudget(roomCount) {
  return Math.max(0, roomCount) * MIN_VIABLE_ROOM_INTERIOR_TILES;
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

function pickSpawnExitFromRooms(mask, levelGen, hazardIndex, rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  const roomWalkable = rooms.map((room) => collectWalkableInRoom(mask, room, hazardIndex));
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

function pickSpawn(mask, levelGen, rng, hazardIndex, preferredRoom = null) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  let cells = collectWalkable(mask, hazardIndex);
  const fallbackCells = cells.length ? cells : collectWalkable(mask, null);
  // When hazards are mapped into a specific room, bias the pre-reconciliation
  // anchor spawn to land inside that same room. reconcileWalkableTiles later
  // grows a single connected component from this anchor while force-including
  // preserved hazard positions — if the anchor starts outside the hazard's room,
  // the preserved hazard cells and the anchor's growing region can end up in
  // two disjoint components. Rooms are fully carved at this point, so any
  // in-room anchor is trivially connected to any in-room hazard.
  if (preferredRoom) {
    const inRoom = cells.filter((cell) => pointInRoom(preferredRoom, cell));
    if (inRoom.length > 0) {
      cells = inRoom;
    }
  }
  const spawnCandidates = filterEdgeCandidates(cells, width, height, levelGen.spawn.edgeBias);
  return pickCandidate(spawnCandidates, rng) || cells[0] || fallbackCells[0] || { x: 0, y: 0 };
}

function pickExit(mask, levelGen, rng, hazardIndex, spawn) {
  const height = mask.length;
  const width = mask[0]?.length || 0;
  const cells = collectWalkable(mask, hazardIndex);
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

function buildTiles(mask, spawn, exit, hazardIndex = null) {
  const tiles = [];
  for (let y = 0; y < mask.length; y += 1) {
    let row = "";
    for (let x = 0; x < mask[y].length; x += 1) {
      if (spawn.x === x && spawn.y === y) {
        row += "S";
      } else if (exit.x === x && exit.y === y) {
        row += "E";
      } else if (mask[y][x] || isHazardCell(hazardIndex, x, y)) {
        // A blocking hazard occupies floor — it blocks movement (see `kinds`/
        // KIND_HAZARD and layout.hazards[].blocking), but the tile itself is not
        // a wall. applyHazardBlocking() clears the mask cell for blocking hazards
        // so movement code treats it as non-walkable; rendering must not
        // reintroduce a wall there or hazard_on_wall validation trips on a
        // hazard's own tile.
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

function buildKinds(mask, hazardIndex) {
  const kinds = [];
  for (let y = 0; y < mask.length; y += 1) {
    const row = [];
    for (let x = 0; x < mask[y].length; x += 1) {
      let kind = mask[y][x] ? KIND_STATIONARY : KIND_BARRIER;
      if (isHazardCell(hazardIndex, x, y)) {
        kind = KIND_HAZARD;
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
  // Keep generation room-first: place distinct room islands, then connect.
  ensureRoomsConnected(mask, rooms, rng, settings.corridorWidth);
  applyPatternOverlay(mask, rooms, levelGen);
  ensureWalkable(mask);
  return { mask, rooms };
}

export function generateGridLayout(levelGen) {
  const seed = Number.isFinite(levelGen.seed) ? levelGen.seed : 0;
  const rng = createRng(seed);
  const { mask, rooms } = generateMask(levelGen, rng);
  const rawHazards = Array.isArray(levelGen.hazards) ? levelGen.hazards : [];
  // Authored hazard x/y are room-relative; map them into the target room's
  // interior now, before any carving/validation reads hazard.x/hazard.y. Hazards
  // whose coordinates exceed their room's interior are dropped here and
  // reported via hazardMappingErrors so the caller can reject with a
  // structured error instead of carving floor outside declared rooms.
  const { mapped: hazards, errors: hazardMappingErrors } = mapHazardsToRooms(rawHazards, rooms);
  applyHazardBlocking(mask, hazards);
  const blockingHazardIndex = buildBlockingHazardIndex(hazards);
  const walkableTilesTarget = resolveWalkableTilesTarget(levelGen);
  const requiresConnectedWalkable = Boolean(levelGen.connectivity?.requirePath);
  const corridorWidth = resolveCorridorWidth(levelGen);

  ensureWalkable(mask);
  const hazardIndex = buildHazardIndex(hazards);
  // Hazards map into rooms[0] (see mapHazardsToRooms); bias the reconciliation
  // anchor to that same room so the connected-tiles pass below can't strand
  // preserved hazard positions in a component the anchor never reaches.
  const hazardAnchorRoom = hazards.length > 0 && rooms.length > 0 ? rooms[0] : null;

  let spawn = null;
  if (requiresConnectedWalkable) {
    spawn = pickSpawn(mask, levelGen, rng, hazardIndex, hazardAnchorRoom);
    // When an explicit walkable target is set, connected reconciliation will build
    // a single connected component from spawn. Avoid the expensive pre-pass.
    if (!walkableTilesTarget) {
      ensureConnectedToSpawn(mask, spawn, corridorWidth, blockingHazardIndex);
    }
  }

  const currentWalkableTiles = countWalkableMask(mask);

  // I4: multiple declared rooms plus a floorTile budget must distribute the
  // budget across every room rather than letting a single-anchor carve drain
  // it inside one room, leaving later rooms declared + billed but 100% wall.
  // Below MIN_VIABLE_ROOM_INTERIOR_TILES per room (plus the connectivity
  // backbone joining the rooms), no distribution can keep every room
  // playable, so report a structured error instead of silently under-carving;
  // generateGridLayoutFromInput turns this into a rejection.
  let floorBudgetErrors = [];
  if (walkableTilesTarget && rooms.length > 1) {
    const required = minimumViableFloorBudget(rooms.length);
    if (walkableTilesTarget < required) {
      floorBudgetErrors = [
        {
          field: "floorTile.count",
          code: "floor_tile_budget_insufficient",
          detail: {
            target: walkableTilesTarget,
            roomCount: rooms.length,
            minPerRoom: MIN_VIABLE_ROOM_INTERIOR_TILES,
            required,
          },
        },
      ];
    }
  }

  if (floorBudgetErrors.length === 0 && walkableTilesTarget && currentWalkableTiles !== walkableTilesTarget) {
    const nonBlockingHazardPositions = hazards
      .filter((t) => !t.blocking)
      .map((t) => ({ x: t.x, y: t.y }));
    if (requiresConnectedWalkable && rooms.length > 1) {
      // Multi-room + explicit floor budget: distribute the budget across
      // every declared room (backbone + even split, see
      // distributeWalkableTilesAcrossRooms) instead of growing a single
      // connected component from spawn, which drained the whole budget
      // inside the spawn's room.
      const distribution = distributeWalkableTilesAcrossRooms({
        mask,
        targetWalkableTiles: walkableTilesTarget,
        rooms,
        blockedIndex: blockingHazardIndex,
        hazardIndex,
        preserve: nonBlockingHazardPositions,
      });
      if (!distribution.ok) {
        floorBudgetErrors = [distribution.error];
      }
    } else {
      reconcileWalkableTiles({
        mask,
        targetWalkableTiles: walkableTilesTarget,
        blockedIndex: blockingHazardIndex,
        requireConnected: requiresConnectedWalkable,
        anchor: spawn,
        preserve: spawn ? [spawn, ...nonBlockingHazardPositions] : nonBlockingHazardPositions,
      });
    }
  }
  // When walkableTilesTarget is set, reconcileConnectedWalkableTiles already
  // built a connected component from spawn — a second connectivity pass would
  // add cells and break the tile-count contract.
  if (requiresConnectedWalkable && spawn && mask[spawn.y]?.[spawn.x] && !walkableTilesTarget) {
    ensureConnectedToSpawn(mask, spawn, corridorWidth, blockingHazardIndex);
  }

  ensureWalkable(mask);
  const roomPlacement = pickSpawnExitFromRooms(mask, levelGen, hazardIndex, rooms);
  if (roomPlacement?.spawn) {
    spawn = roomPlacement.spawn;
  }
  if (!spawn || !mask[spawn.y]?.[spawn.x] || isHazardCell(hazardIndex, spawn.x, spawn.y)) {
    spawn = pickSpawn(mask, levelGen, rng, hazardIndex);
  }

  let exit = roomPlacement?.exit || null;
  if (
    !exit
    || (exit.x === spawn.x && exit.y === spawn.y)
    || !mask[exit.y]?.[exit.x]
    || isHazardCell(hazardIndex, exit.x, exit.y)
  ) {
    exit = pickExit(mask, levelGen, rng, hazardIndex, spawn);
  }
  const layout = {
    width: levelGen.width,
    height: levelGen.height,
    tiles: buildTiles(mask, spawn, exit, hazardIndex),
    kinds: buildKinds(mask, hazardIndex),
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
  if (hazards.length > 0) {
    layout.hazards = hazards.map((hazard) => ({ ...hazard }));
  }
  if (hazardMappingErrors.length > 0) {
    // Non-enumerable so JSON.stringify(layout) / normal consumers stay
    // unaffected; generateGridLayoutFromInput reads this to reject the
    // request instead of returning a layout with hazards outside every room.
    Object.defineProperty(layout, "_hazardMappingErrors", {
      value: hazardMappingErrors,
      enumerable: false,
    });
  }
  if (floorBudgetErrors.length > 0) {
    // Same pattern as _hazardMappingErrors: non-enumerable so normal consumers
    // are unaffected; generateGridLayoutFromInput reads this to reject
    // requests whose floorTile budget can't cover every declared room's
    // minimum viable interior (I4).
    Object.defineProperty(layout, "_floorBudgetErrors", {
      value: floorBudgetErrors,
      enumerable: false,
    });
  }
  return layout;
}

function countLayoutWalkableTiles(layout) {
  if (!Array.isArray(layout?.tiles)) return 0;
  // Blocking hazards render as floor glyphs (buildTiles) but their mask cell is
  // cleared by applyHazardBlocking — they are not movement-walkable and must not
  // count toward the walkableTilesTarget floor budget.
  const blockedHazardCells = new Set();
  for (const hazard of Array.isArray(layout.hazards) ? layout.hazards : []) {
    if (hazard?.blocking) blockedHazardCells.add(`${hazard.x},${hazard.y}`);
  }
  let count = 0;
  for (let y = 0; y < layout.tiles.length; y += 1) {
    const row = String(layout.tiles[y] || "");
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== "#" && !blockedHazardCells.has(`${x},${y}`)) count += 1;
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

  if (Array.isArray(layout._hazardMappingErrors) && layout._hazardMappingErrors.length > 0) {
    return { ok: false, errors: layout._hazardMappingErrors, warnings: normalized.warnings, value: null };
  }

  if (Array.isArray(layout._floorBudgetErrors) && layout._floorBudgetErrors.length > 0) {
    return { ok: false, errors: layout._floorBudgetErrors, warnings: normalized.warnings, value: null };
  }

  if (Array.isArray(layout.hazards) && layout.hazards.length > 0 && Array.isArray(layout.tiles)) {
    const wallHazardErrors = [];
    layout.hazards.forEach((hazard, idx) => {
      const row = layout.tiles[hazard.y];
      if (typeof row === "string" && row[hazard.x] === "#") {
        wallHazardErrors.push({
          field: `hazards[${idx}].position`,
          code: "hazard_on_wall",
          detail: { x: hazard.x, y: hazard.y, affinity: hazard.affinity?.kind },
        });
      }
    });
    if (wallHazardErrors.length > 0) {
      return { ok: false, errors: wallHazardErrors, warnings: normalized.warnings, value: null };
    }
  }

  // Universal placement invariant (hard rule): every positioned element must
  // sit on a walkable tile — nothing may exist inside a wall. Hazards are
  // covered above with their dedicated code; hazards and resources are
  // generator-placed and hold this by construction, so this check is a
  // defense-in-depth guard against placement regressions.
  if (Array.isArray(layout.tiles)) {
    const wallElementErrors = [];
    for (const kind of ["hazards", "resources"]) {
      const elements = Array.isArray(layout[kind]) ? layout[kind] : [];
      elements.forEach((element, idx) => {
        const x = element?.position?.x ?? element?.x;
        const y = element?.position?.y ?? element?.y;
        if (!Number.isInteger(x) || !Number.isInteger(y)) return;
        const row = layout.tiles[y];
        if (typeof row === "string" && row[x] === "#") {
          wallElementErrors.push({
            field: `${kind}[${idx}].position`,
            code: "element_on_wall",
            detail: { x, y, id: element.id },
          });
        }
      });
    }
    if (wallElementErrors.length > 0) {
      return { ok: false, errors: wallElementErrors, warnings: normalized.warnings, value: null };
    }
  }

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
