const test = require("node:test");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const layoutModule = moduleUrl("packages/runtime/src/personas/configurator/level-layout.js");
const levelGenModule = moduleUrl("packages/runtime/src/personas/configurator/level-gen.js");

const fixturesDir = resolve(__dirname, "../fixtures");
const fixtures = readdirSync(fixturesDir)
  .filter((name) => name.startsWith("level-gen-fixture-") && name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")));

test("level layout generator produces deterministic layouts", () => {
const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayout } from ${JSON.stringify(layoutModule)};

const fixtures = ${JSON.stringify(fixtures)};
fixtures.forEach((fixture) => {
  assert.equal(fixture.schema, "agent-kernel/LevelGenFixture");
  assert.equal(fixture.schemaVersion, 1);
  const normalized = normalizeLevelGenInput(fixture.input);
  assert.equal(normalized.ok, true);
  const layout = generateGridLayout(normalized.value);
  assert.deepEqual(layout, fixture.expected);
  const layoutAgain = generateGridLayout(normalized.value);
  assert.deepEqual(layoutAgain, fixture.expected);
  const spawn = layout.spawn;
  const exit = layout.exit;
  assert.equal(layout.kinds[spawn.y][spawn.x], 0);
  assert.equal(layout.kinds[exit.y][exit.x], 0);
  layout.tiles.forEach((row, y) => {
    row.split("").forEach((cell, x) => {
      const kind = layout.kinds[y][x];
      if (cell === "#") assert.equal(kind, 1);
      if (cell === "." || cell === "S" || cell === "E") assert.ok(kind === 0 || kind === 2);
    });
  });
});
`;
  runEsm(script);
});

test("clustered islands connect all walkable tiles to spawn when requirePath is true", () => {
const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayout } from ${JSON.stringify(layoutModule)};

function isWalkable(cell) {
  return cell !== "#";
}

function walkableReachableCount(layout) {
  const height = layout.tiles.length;
  const width = layout.tiles[0]?.length || 0;
  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const queue = [{ x: layout.spawn.x, y: layout.spawn.y }];
  visited[layout.spawn.y][layout.spawn.x] = true;
  let head = 0;
  let reachable = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    reachable += 1;
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    neighbors.forEach((next) => {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) return;
      if (visited[next.y][next.x]) return;
      if (!isWalkable(layout.tiles[next.y][next.x])) return;
      visited[next.y][next.x] = true;
      queue.push(next);
    });
  }

  let totalWalkable = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isWalkable(layout.tiles[y][x])) {
        totalWalkable += 1;
      }
    }
  }
  return { reachable, totalWalkable };
}

const normalized = normalizeLevelGenInput({
  width: 24,
  height: 24,
  seed: 0,
  shape: { profile: "clustered_islands", clusterSize: 6 },
  spawn: { edgeBias: false, minDistance: 2 },
  exit: { edgeBias: false, minDistance: 2 },
  connectivity: { requirePath: true },
});
assert.equal(normalized.ok, true);

const layout = generateGridLayout(normalized.value);
const counts = walkableReachableCount(layout);
assert.ok(counts.totalWalkable > 0);
assert.equal(counts.reachable, counts.totalWalkable);
`;
  runEsm(script);
});

test("level layout honors walkable tile targets across all profiles", () => {
const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayoutFromInput } from ${JSON.stringify(layoutModule)};

const targetWalkableTiles = 1800;
const profiles = [
  { profile: "rectangular", shape: { profile: "rectangular" } },
  { profile: "sparse_islands", shape: { profile: "sparse_islands", density: 0.3 } },
  { profile: "clustered_islands", shape: { profile: "clustered_islands", clusterSize: 8 } },
  { profile: "rooms", shape: { profile: "rooms", roomCount: 8, roomMinSize: 4, roomMaxSize: 12, corridorWidth: 1 } },
];

function countWalkable(tiles = []) {
  return tiles.reduce((sum, row) => {
    const text = String(row ?? "");
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "#") sum += 1;
    }
    return sum;
  }, 0);
}

profiles.forEach(({ profile, shape }) => {
  const normalized = normalizeLevelGenInput({
    width: 45,
    height: 45,
    seed: 42,
    walkableTilesTarget: targetWalkableTiles,
    shape,
    spawn: { edgeBias: false, minDistance: 2 },
    exit: { edgeBias: false, minDistance: 2 },
    connectivity: { requirePath: true },
  });
  assert.equal(normalized.ok, true, profile);
  const layoutResult = generateGridLayoutFromInput(normalized.value);
  assert.equal(layoutResult.ok, true, profile);
  assert.equal(countWalkable(layoutResult.value.tiles), targetWalkableTiles, profile);
});
`;
  runEsm(script);
});

test("high-fill sparse targets avoid fragmented checkerboard topology", () => {
const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayout } from ${JSON.stringify(layoutModule)};

function analyzeTopology(tiles = []) {
  const height = tiles.length;
  const width = tiles[0]?.length || 0;
  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  let totalWalkable = 0;
  let deadEnds = 0;
  let componentCount = 0;
  let largestComponent = 0;
  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  const isWalkable = (x, y) => y >= 0 && y < height && x >= 0 && x < width && tiles[y][x] !== "#";

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isWalkable(x, y)) continue;
      totalWalkable += 1;
      let degree = 0;
      for (const delta of neighbors) {
        if (isWalkable(x + delta.dx, y + delta.dy)) degree += 1;
      }
      if (degree <= 1) deadEnds += 1;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isWalkable(x, y) || visited[y][x]) continue;
      componentCount += 1;
      let size = 0;
      const queue = [{ x, y }];
      visited[y][x] = true;
      let head = 0;
      while (head < queue.length) {
        const current = queue[head];
        head += 1;
        size += 1;
        for (const delta of neighbors) {
          const nx = current.x + delta.dx;
          const ny = current.y + delta.dy;
          if (!isWalkable(nx, ny) || visited[ny][nx]) continue;
          visited[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
      if (size > largestComponent) largestComponent = size;
    }
  }

  return {
    totalWalkable,
    componentCount,
    largestComponentRatio: totalWalkable > 0 ? largestComponent / totalWalkable : 1,
    deadEndRatio: totalWalkable > 0 ? deadEnds / totalWalkable : 0,
  };
}

const normalized = normalizeLevelGenInput({
  width: 52,
  height: 52,
  seed: 99,
  walkableTilesTarget: 1800,
  shape: { profile: "sparse_islands", density: 0.35 },
  connectivity: { requirePath: true },
});
assert.equal(normalized.ok, true);
assert.equal(normalized.value.shape.profile, "clustered_islands");

const layout = generateGridLayout(normalized.value);
const metrics = analyzeTopology(layout.tiles);
assert.equal(metrics.totalWalkable, 1800);
assert.ok(metrics.componentCount <= 12);
assert.ok(metrics.largestComponentRatio >= 0.7);
assert.ok(metrics.deadEndRatio <= 0.2);
`;
  runEsm(script);
});
