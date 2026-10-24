/**
 * #370 — hazards and resources with no coordinates used to be seated in a row, touching, so a
 * neighbour's field could destroy one on tick 1. The Configurator's placement now keeps them
 * apart (no two within one king move) wherever the level has room, and still builds, as spread
 * as it fits, where it does not.
 */
"use strict";

const assert = require("node:assert/strict");

const CREATED_AT = "2026-10-18T00:00:00.000Z";
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

async function placer() {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  const { createHostedObjectPlacer } = await import("../../../packages/runtime/src/commands/solver-host.js");
  const { createHybridConstraintSolverAdapter } = await import("../../../packages/adapters-cli/src/adapters/z3/index.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  return createHostedObjectPlacer({
    prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement,
    adapter: createHybridConstraintSolverAdapter(),
    clock: () => CREATED_AT,
  });
}

function board(width, height) {
  const terrain = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      terrain.push(y === 0 && x === 1 ? "spawn" : y === height - 1 && x === width - 2 ? "exit" : edge ? "wall" : "floor");
    }
  }
  return { width, height, terrain, spawnApproach: { x: 1, y: 1 }, exitApproach: { x: width - 2, y: height - 2 }, rooms: [] };
}

// Every opposed pair is represented; the affinity is only data here.
const AFFINITIES = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const hazards = (count) => Array.from({ length: count }, (_, index) => ({
  id: `hazard_${index + 1}`,
  affinity: { kind: AFFINITIES[index % AFFINITIES.length], expression: "emit", stacks: 1 },
}));
const resources = (count) => Array.from({ length: count }, (_, index) => ({
  id: `resource_${index + 1}`, vitals: { durability: { current: 1, max: 1, regen: 0 } }, holdings: [],
}));

function touchingPairs(actors) {
  const pairs = [];
  actors.forEach((left, index) => actors.slice(index + 1).forEach((right) => {
    if (chebyshev(left.position, right.position) <= 1) pairs.push(`${left.id}/${right.id}`);
  }));
  return pairs;
}

test("unplaced hazards and resources are seated apart when the level has room", async () => {
  const place = await placer();
  const result = await place({ layout: board(14, 10), hazards: hazards(10), resources: resources(4), actors: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.source, "solver");
  assert.equal(result.actors.length, 14);
  assert.deepEqual(touchingPairs(result.actors), []);
});

test("objects already in place count: new ones are not seated against them", async () => {
  const place = await placer();
  const fixed = { ...hazards(1)[0], id: "fixed", position: { x: 2, y: 2 } };
  const result = await place({ layout: board(10, 8), hazards: [fixed, ...hazards(3)], resources: resources(2), actors: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.actors.find(({ id }) => id === "fixed").position.x, 2);
  assert.deepEqual(touchingPairs(result.actors), []);
});

test("a level too small to keep them apart still builds, as spread as it fits", async () => {
  const place = await placer();
  // A 3x3 floor: spawn and exit approaches take two corners, seven cells are left for five objects.
  const result = await place({ layout: board(5, 5), hazards: hazards(3), resources: resources(2), actors: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.actors.length, 5);
  const cells = result.actors.map(({ position }) => `${position.x},${position.y}`);
  assert.equal(new Set(cells).size, 5);
});

// #403: a lasting field reaches its range, so two objects sit further apart than the larger
// reach of the pair (and never touching). A range-2 emit two cells from its neighbour hit it on tick 1.
const reachOf = (actor) => (actor.affinities || [])
  .filter(({ expression }) => expression === "emit" || expression === "draw")
  .reduce((most, { stacks }) => Math.max(most, stacks), 1);
function pairsInReach(actors) {
  const pairs = [];
  actors.forEach((left, index) => actors.slice(index + 1).forEach((right) => {
    if (chebyshev(left.position, right.position) <= Math.max(reachOf(left), reachOf(right))) pairs.push(`${left.id}/${right.id}`);
  }));
  return pairs;
}
const fieldHazards = (count, stacks, expression = "emit") => hazards(count).map((hazard) => ({
  ...hazard, affinity: { ...hazard.affinity, expression, stacks },
}));

test.each(["emit", "draw"])("unplaced %s hazards are seated out of each other's reach (#403)", async (expression) => {
  const place = await placer();
  const result = await place({ layout: board(14, 10), hazards: fieldHazards(3, 2, expression), resources: [], actors: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(pairsInReach(result.actors), []);
});

test("only a field's own reach spreads things out: objects with none just keep from touching (#403)", async () => {
  const place = await placer();
  const result = await place({ layout: board(14, 10), hazards: fieldHazards(1, 3), resources: resources(3), actors: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(pairsInReach(result.actors), []);
  const plain = result.actors.filter(({ id }) => id.startsWith("resource_"));
  const closest = Math.min(...plain.flatMap((left, index) => plain.slice(index + 1).map((right) => chebyshev(left.position, right.position))));
  assert.equal(closest, 2, "resources sit two apart, not three: they have no field");
});

test("a field already in place keeps new objects out of its reach (#403)", async () => {
  const place = await placer();
  const fixed = { ...fieldHazards(1, 3)[0], id: "fixed", position: { x: 2, y: 2 } };
  const result = await place({ layout: board(14, 10), hazards: [fixed], resources: resources(3), actors: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(pairsInReach(result.actors), []);
});

// ## TODO: Test Permutations
// - two objects restricted to one room two cells wide touch, and nothing else does
// - a route-sealing hazard keeps the route open while staying apart from the rest
// - resources placed with the layout (data.resources) are kept apart from too
