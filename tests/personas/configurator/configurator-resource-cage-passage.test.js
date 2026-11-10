/**
 * A resource cage must not seal the level. The interior dividers are planned so the exit stays
 * reachable without clearing a barrier; the cage is planned afterwards and, in a narrow room, its
 * ring spanned the room wall to wall and sat on the exit approach (sweep-demand-recovery: a delver
 * that reached the exit on turn 9 no longer reached it in 80).
 */
const assert = require("node:assert/strict");

const MODULE = "../../../packages/runtime/src/personas/configurator/interior-barriers.js";

// The sweep-demand-recovery level: a 3x5 room at (2,2), exit above its top-left tile, spawn to the
// right of its middle row, the resource on the top row beside the exit approach.
function narrowRoom() {
  const width = 9;
  const height = 9;
  const terrain = Array(width * height).fill("wall");
  for (let y = 2; y <= 6; y += 1) for (let x = 2; x <= 4; x += 1) terrain[y * width + x] = "floor";
  terrain[1 * width + 2] = "exit";
  terrain[4 * width + 5] = "spawn";
  return { width, height, terrain, spawnApproach: { x: 4, y: 4 }, exitApproach: { x: 2, y: 2 } };
}

function reaches(layout, blocked, from, to) {
  const key = (x, y) => `${x},${y}`;
  const seen = new Set([key(from.x, from.y)]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    if (at.x === to.x && at.y === to.y) return true;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (layout.terrain[y * layout.width + x] !== "floor" || blocked.has(key(x, y)) || seen.has(key(x, y))) continue;
      seen.add(key(x, y));
      queue.push({ x, y });
    }
  }
  return false;
}

test("a cage never covers the spawn or exit approach tile", async () => {
  const { buildResourceEnclosureBarrierActorsForResources } = await import(MODULE);
  const layout = narrowRoom();
  const cage = buildResourceEnclosureBarrierActorsForResources(layout, [{ id: "resource_1", position: { x: 3, y: 2 } }]);
  const cells = cage.map((actor) => `${actor.position.x},${actor.position.y}`);
  assert.ok(!cells.includes("2,2"), "the exit approach must stay open");
  assert.ok(!cells.includes("4,4"), "the spawn approach must stay open");
});

test("a resource whose ring would wall the room off gets no cage, and the exit stays reachable", async () => {
  const { buildResourceEnclosureBarrierActorsForResources, cageCellsToOpenForPassage, planResourceEnclosureCells } = await import(MODULE);
  const layout = narrowRoom();
  const resource = { id: "resource_1", position: { x: 3, y: 2 } };
  const divider = new Set(["3,4"]);
  const planned = new Set(planResourceEnclosureCells(layout, [resource]).map((cell) => `${cell.x},${cell.y}`));
  // The ring spans the room's middle row wall to wall: one of its cells is on every route.
  assert.equal(cageCellsToOpenForPassage(layout, planned, new Set([...divider, "3,2"])).size, 1);
  const cage = buildResourceEnclosureBarrierActorsForResources(layout, [resource], { skipKeys: divider });
  assert.deepEqual(cage, []);
  assert.ok(reaches(layout, new Set([...divider, "3,2"]), layout.spawnApproach, layout.exitApproach));
});

test("only the resource in the chokepoint loses its cage", async () => {
  const { buildResourceEnclosureBarrierActorsForResources } = await import(MODULE);
  const layout = narrowRoom();
  // Widen the bottom of the level so a second resource sits in open floor.
  for (let y = 5; y <= 7; y += 1) for (let x = 1; x <= 7; x += 1) layout.terrain[y * layout.width + x] = "floor";
  const cage = buildResourceEnclosureBarrierActorsForResources(layout, [
    { id: "choke", position: { x: 3, y: 2 } },
    { id: "open", position: { x: 6, y: 6 } },
  ]);
  const cells = cage.map((actor) => `${actor.position.x},${actor.position.y}`).sort();
  assert.deepEqual(cells, ["5,5", "5,6", "5,7", "6,5", "6,7", "7,5", "7,6", "7,7"]);
});

test("a cage in open floor is left whole", async () => {
  const { buildResourceEnclosureBarrierActorsForResources } = await import(MODULE);
  const width = 12;
  const height = 12;
  const terrain = Array(width * height).fill("wall");
  for (let y = 1; y <= 10; y += 1) for (let x = 1; x <= 10; x += 1) terrain[y * width + x] = "floor";
  const layout = { width, height, terrain, spawnApproach: { x: 1, y: 1 }, exitApproach: { x: 10, y: 10 } };
  const cage = buildResourceEnclosureBarrierActorsForResources(layout, [{ id: "r", position: { x: 5, y: 5 } }]);
  assert.equal(cage.length, 8);
});

// ## TODO: Test Permutations
// - two resources whose rings together span a corridor
// - a layout without approach tiles (cards-only paths) keeps today's cage unchanged
// - multi-room levels: the cage sits in a room that is not on the spawn-to-exit route
