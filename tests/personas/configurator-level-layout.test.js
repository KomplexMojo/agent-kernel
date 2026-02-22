const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const layoutModule = moduleUrl("packages/runtime/src/personas/configurator/level-layout.js");
const levelGenModule = moduleUrl("packages/runtime/src/personas/configurator/level-gen.js");

test("level layout generator is deterministic for rooms-and-hallways inputs", () => {
const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayout } from ${JSON.stringify(layoutModule)};

const inputs = [
  {
    width: 25,
    height: 25,
    seed: 42,
    shape: { roomCount: 6, roomMinSize: 3, roomMaxSize: 8, corridorWidth: 2 },
    connectivity: { requirePath: true },
  },
  {
    width: 32,
    height: 32,
    seed: 7,
    shape: { roomCount: 10, roomMinSize: 3, roomMaxSize: 9, corridorWidth: 1 },
    connectivity: { requirePath: true },
  },
];

inputs.forEach((input) => {
  const normalized = normalizeLevelGenInput(input);
  assert.equal(normalized.ok, true);
  const layoutA = generateGridLayout(normalized.value);
  const layoutB = generateGridLayout(normalized.value);
  assert.deepEqual(layoutA, layoutB);
  assert.ok(Array.isArray(layoutA.rooms));
  assert.ok(layoutA.rooms.length > 0);
});
`;
  runEsm(script);
});

test("level layout honors walkable tile targets for connected rooms", () => {
const script = `
import assert from "node:assert/strict";
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

const targetWalkableTiles = 1800;
const result = generateGridLayoutFromInput({
  width: 45,
  height: 45,
  seed: 42,
  walkableTilesTarget: targetWalkableTiles,
  shape: { roomCount: 12, roomMinSize: 3, roomMaxSize: 10, corridorWidth: 2 },
  spawn: { edgeBias: false, minDistance: 2 },
  exit: { edgeBias: false, minDistance: 2 },
  connectivity: { requirePath: true },
});
assert.equal(result.ok, true);

const walkable = result.value.tiles.reduce((sum, row) => {
  const text = String(row ?? "");
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "#") sum += 1;
  }
  return sum;
}, 0);
assert.equal(walkable, targetWalkableTiles);
assert.ok(result.value.connectivity);
assert.equal(result.value.connectivity.connectedRooms, result.value.connectivity.rooms);
`;
  runEsm(script);
});

test("requirePath guarantees a spawn-to-exit path in room layouts", () => {
const script = `
import assert from "node:assert/strict";
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

const result = generateGridLayoutFromInput({
  width: 60,
  height: 60,
  seed: 9,
  walkableTilesTarget: 2200,
  shape: { roomCount: 16, roomMinSize: 3, roomMaxSize: 11, corridorWidth: 2 },
  connectivity: { requirePath: true },
});
assert.equal(result.ok, true);
const layout = result.value;

const height = layout.tiles.length;
const width = layout.tiles[0]?.length || 0;
const isWalkable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && layout.tiles[y][x] !== "#";
const visited = Array.from({ length: height }, () => Array(width).fill(false));
const queue = [{ x: layout.spawn.x, y: layout.spawn.y }];
visited[layout.spawn.y][layout.spawn.x] = true;
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
    if (!isWalkable(next.x, next.y)) return;
    if (visited[next.y][next.x]) return;
    visited[next.y][next.x] = true;
    queue.push(next);
  });
}

assert.equal(visited[layout.exit.y][layout.exit.x], true);
`;
  runEsm(script);
});

test("wider hallways increase carved walkable area for the same room seed", () => {
const script = `
import assert from "node:assert/strict";
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

const base = {
  width: 40,
  height: 40,
  seed: 11,
  shape: { roomCount: 10, roomMinSize: 4, roomMaxSize: 8 },
  connectivity: { requirePath: true },
};

const narrow = generateGridLayoutFromInput({
  ...base,
  shape: { ...base.shape, corridorWidth: 1 },
});
const wide = generateGridLayoutFromInput({
  ...base,
  shape: { ...base.shape, corridorWidth: 3 },
});
assert.equal(narrow.ok, true);
assert.equal(wide.ok, true);

const countWalkable = (tiles) => tiles.reduce((sum, row) => {
  const text = String(row ?? "");
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "#") sum += 1;
  }
  return sum;
}, 0);

assert.ok(countWalkable(wide.value.tiles) >= countWalkable(narrow.value.tiles));
`;
  runEsm(script);
});

test("high-scale walkable room layouts complete in practical time", () => {
const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

const targetWalkableTiles = 550000;
const side = Math.max(5, Math.ceil(Math.sqrt(targetWalkableTiles / 0.5)) + 2);
const normalized = normalizeLevelGenInput({
  width: side,
  height: side,
  seed: 7,
  walkableTilesTarget: targetWalkableTiles,
  shape: { roomCount: 64, roomMinSize: 4, roomMaxSize: 24, corridorWidth: 2 },
  connectivity: { requirePath: true },
});
assert.equal(normalized.ok, true);

const startedAt = performance.now();
const layoutResult = generateGridLayoutFromInput(normalized.value);
const elapsedMs = performance.now() - startedAt;
assert.equal(layoutResult.ok, true);

const walkable = layoutResult.value.tiles.reduce((sum, row) => {
  const text = String(row || "");
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "#") sum += 1;
  }
  return sum;
}, 0);
assert.equal(walkable, targetWalkableTiles);
assert.ok(elapsedMs < 10000, \`expected large room layout under 10s, got \${elapsedMs.toFixed(2)}ms\`);
`;
  runEsm(script);
});

test("grid overlay carves internal room barriers while preserving movement gaps", () => {
const script = `
import assert from "node:assert/strict";
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

function buildRoomIndex(layout) {
  const height = layout.tiles.length;
  const width = layout.tiles[0]?.length || 0;
  const index = Array.from({ length: height }, () => Array(width).fill(-1));
  (layout.rooms || []).forEach((room, roomId) => {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (y < 0 || y >= height || x < 0 || x >= width) continue;
        index[y][x] = roomId;
      }
    }
  });
  return index;
}

function countInternalBlocked(layout) {
  const roomIndex = buildRoomIndex(layout);
  let blocked = 0;
  let mixedRooms = 0;
  (layout.rooms || []).forEach((room, roomId) => {
    let roomBlocked = 0;
    let roomWalkable = 0;
    for (let y = room.y; y < room.y + room.height; y += 1) {
      const row = String(layout.tiles[y] || "");
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (roomIndex[y]?.[x] !== roomId) continue;
        const char = row[x];
        if (char === "#") {
          blocked += 1;
          roomBlocked += 1;
        } else {
          roomWalkable += 1;
        }
      }
    }
    if (roomBlocked > 0 && roomWalkable > 0) {
      mixedRooms += 1;
    }
  });
  return { blocked, mixedRooms };
}

function hasGapAroundInternalBarrier(layout) {
  const roomIndex = buildRoomIndex(layout);
  const height = layout.tiles.length;
  const width = layout.tiles[0]?.length || 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = String(layout.tiles[y] || "");
    for (let x = 1; x < width - 1; x += 1) {
      if (roomIndex[y]?.[x] < 0) continue;
      if (row[x] !== "#") continue;
      const neighbors = [
        layout.tiles[y - 1][x],
        layout.tiles[y + 1][x],
        layout.tiles[y][x - 1],
        layout.tiles[y][x + 1],
      ];
      const walkableNeighbors = neighbors.filter((cell) => cell !== "#").length;
      if (walkableNeighbors >= 2) {
        return true;
      }
    }
  }
  return false;
}

const baseInput = {
  width: 44,
  height: 44,
  seed: 17,
  shape: { roomCount: 10, roomMinSize: 4, roomMaxSize: 10, corridorWidth: 2 },
  connectivity: { requirePath: true },
};

const gridResult = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "grid", patternSpacing: 6, patternLineWidth: 1, patternGapEvery: 4, patternInset: 1 },
});
const noneResult = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "none" },
});

assert.equal(gridResult.ok, true);
assert.equal(noneResult.ok, true);

const gridStats = countInternalBlocked(gridResult.value);
const noneStats = countInternalBlocked(noneResult.value);
assert.ok(gridStats.blocked > noneStats.blocked);
assert.ok(gridStats.mixedRooms > 0);
assert.equal(hasGapAroundInternalBarrier(gridResult.value), true);
assert.equal(gridResult.value.connectivity.exitReachable, true);
`;
  runEsm(script);
});

test("diagonal and concentric hallway overlays carve patterned internal barriers", () => {
const script = `
import assert from "node:assert/strict";
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

function buildRoomIndex(layout) {
  const height = layout.tiles.length;
  const width = layout.tiles[0]?.length || 0;
  const index = Array.from({ length: height }, () => Array(width).fill(-1));
  (layout.rooms || []).forEach((room, roomId) => {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (y < 0 || y >= height || x < 0 || x >= width) continue;
        index[y][x] = roomId;
      }
    }
  });
  return index;
}

function countInternalBlocked(layout) {
  const roomIndex = buildRoomIndex(layout);
  let blocked = 0;
  (layout.rooms || []).forEach((room, roomId) => {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      const row = String(layout.tiles[y] || "");
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (roomIndex[y]?.[x] !== roomId) continue;
        if (row[x] === "#") blocked += 1;
      }
    }
  });
  return blocked;
}

function countWalkable(layout) {
  return layout.tiles.reduce((sum, row) => {
    const text = String(row || "");
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "#") sum += 1;
    }
    return sum;
  }, 0);
}

const baseInput = {
  width: 48,
  height: 48,
  seed: 33,
  shape: { roomCount: 12, roomMinSize: 4, roomMaxSize: 10, corridorWidth: 2 },
  connectivity: { requirePath: true },
};

const diagonal = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "diagonal_grid", patternLineWidth: 1, patternInfillPercent: 70, patternGapEvery: 4, patternInset: 1 },
});
const concentric = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "concentric_circles", patternLineWidth: 1, patternInfillPercent: 70, patternGapEvery: 4, patternInset: 1 },
});
const none = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "none" },
});

assert.equal(diagonal.ok, true);
assert.equal(concentric.ok, true);
assert.equal(none.ok, true);
assert.ok(countWalkable(diagonal.value) > countWalkable(none.value));
assert.ok(countWalkable(concentric.value) > countWalkable(none.value));
assert.ok(
  Math.max(countInternalBlocked(diagonal.value), countInternalBlocked(concentric.value))
    > countInternalBlocked(none.value),
);
assert.equal(diagonal.value.connectivity.exitReachable, true);
assert.equal(concentric.value.connectivity.exitReachable, true);
`;
  runEsm(script);
});

test("higher hallway infill produces denser in-room overlay carving", () => {
const script = `
import assert from "node:assert/strict";
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

function buildRoomIndex(layout) {
  const height = layout.tiles.length;
  const width = layout.tiles[0]?.length || 0;
  const index = Array.from({ length: height }, () => Array(width).fill(-1));
  (layout.rooms || []).forEach((room, roomId) => {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (y < 0 || y >= height || x < 0 || x >= width) continue;
        index[y][x] = roomId;
      }
    }
  });
  return index;
}

function countInternalBlocked(layout) {
  const roomIndex = buildRoomIndex(layout);
  let blocked = 0;
  for (let y = 0; y < layout.tiles.length; y += 1) {
    const row = String(layout.tiles[y] || "");
    for (let x = 0; x < row.length; x += 1) {
      if (roomIndex[y]?.[x] < 0) continue;
      if (row[x] === "#") blocked += 1;
    }
  }
  return blocked;
}

const base = {
  width: 50,
  height: 50,
  seed: 51,
  shape: {
    roomCount: 12,
    roomMinSize: 4,
    roomMaxSize: 10,
    corridorWidth: 2,
    pattern: "grid",
    patternLineWidth: 1,
    patternGapEvery: 4,
    patternInset: 1,
  },
  connectivity: { requirePath: true },
};

const sparse = generateGridLayoutFromInput({
  ...base,
  shape: { ...base.shape, patternInfillPercent: 25 },
});
const dense = generateGridLayoutFromInput({
  ...base,
  shape: { ...base.shape, patternInfillPercent: 85 },
});

assert.equal(sparse.ok, true);
assert.equal(dense.ok, true);
assert.ok(countInternalBlocked(dense.value) >= countInternalBlocked(sparse.value));
assert.equal(dense.value.connectivity.exitReachable, true);
`;
  runEsm(script);
});

test("pattern overlays do not block walkable room perimeter tiles", () => {
const script = `
import assert from "node:assert/strict";
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

function roomPerimeterCells(room) {
  const cells = [];
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      const onPerimeter = (
        x === room.x
        || x === room.x + room.width - 1
        || y === room.y
        || y === room.y + room.height - 1
      );
      if (onPerimeter) cells.push({ x, y });
    }
  }
  return cells;
}

function assertPerimeterPreserved(baseLayout, patternedLayout) {
  (baseLayout.rooms || []).forEach((room) => {
    roomPerimeterCells(room).forEach(({ x, y }) => {
      const baseChar = String(baseLayout.tiles[y] || "")[x];
      if (baseChar === "#") return;
      const patternedChar = String(patternedLayout.tiles[y] || "")[x];
      assert.notEqual(patternedChar, "#", \`perimeter blocked at \${x},\${y}\`);
    });
  });
}

const baseInput = {
  width: 56,
  height: 56,
  seed: 72,
  shape: { roomCount: 12, roomMinSize: 4, roomMaxSize: 10, corridorWidth: 2 },
  connectivity: { requirePath: true },
};

const none = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "none" },
});
const grid = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "grid", patternSpacing: 4, patternLineWidth: 1, patternGapEvery: 3, patternInset: 0 },
});
const diagonal = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "diagonal_grid", patternInfillPercent: 75, patternLineWidth: 1, patternGapEvery: 3, patternInset: 0 },
});
const concentric = generateGridLayoutFromInput({
  ...baseInput,
  shape: { ...baseInput.shape, pattern: "concentric_circles", patternInfillPercent: 75, patternLineWidth: 1, patternGapEvery: 3, patternInset: 0 },
});

assert.equal(none.ok, true);
assert.equal(grid.ok, true);
assert.equal(diagonal.ok, true);
assert.equal(concentric.ok, true);

assertPerimeterPreserved(none.value, grid.value);
assertPerimeterPreserved(none.value, diagonal.value);
assertPerimeterPreserved(none.value, concentric.value);
`;
  runEsm(script);
});
