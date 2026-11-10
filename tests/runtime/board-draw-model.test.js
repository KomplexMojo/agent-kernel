// #770: a graphical client draws from the same play view as ASCII. The draw model is a pure
// projection of that view: same fog, same standing entities, a two-channel sprite per entity,
// and the seat HUD straight from the view's player model.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const LEVELS = resolve(ROOT, "packages/ui-ascii/levels");
const NAMES = ["first-steps", "warden-hall", "trap-rooms"];

async function open(name, fog = true) {
  const { createPlaySession } = await import("../../packages/runtime/src/runner/play-session.js");
  const read = (suffix) => JSON.parse(readFileSync(resolve(LEVELS, `${name}.${suffix}.json`), "utf8"));
  return createPlaySession({ simConfig: read("sim-config"), initialState: read("initial-state"), fog });
}

async function played(name, turns = 4) {
  const session = await open(name);
  for (let i = 0; i < turns; i += 1) await session.act({ kind: "wait" });
  return session.view();
}

for (const name of NAMES) {
  test(`${name}: the draw model carries the view's fog and exactly its standing entities`, async () => {
    const { buildBoardDrawModel } = await import("../../packages/runtime/src/render/board-draw-model.js");
    const view = await played(name);
    const model = buildBoardDrawModel(view);
    assert.equal(model.height, view.rows.length);
    assert.equal(model.width, view.rows[0].length);
    model.cells.forEach((row, y) => row.forEach((cell, x) => {
      assert.equal(cell.sight, view.sight[y][x]);
      if (cell.sight === "u") assert.equal(cell.tile, "fog", `unknown cell ${x},${y} must stay fog`);
    }));
    const viewIds = [view.player, ...view.actors, ...view.hazards, ...view.lootBodies].filter(Boolean).map((e) => e.id).sort();
    assert.deepEqual(model.entities.map((e) => e.id).sort(), viewIds);
    for (const entity of model.entities) {
      assert.notEqual(model.cells[entity.y][entity.x].sight, "u", `${entity.id} stands in an unknown cell`);
    }
  });

  test(`${name}: every sprite has exactly the two channels role and affinity`, async () => {
    const { buildBoardDrawModel } = await import("../../packages/runtime/src/render/board-draw-model.js");
    const model = buildBoardDrawModel(await played(name));
    assert.ok(model.entities.length > 0);
    for (const entity of model.entities) assert.deepEqual(Object.keys(entity.sprite).sort(), ["affinity", "role"]);
  });
}

test("the seat HUD is the view's player model, untouched by the board", async () => {
  const { buildBoardDrawModel } = await import("../../packages/runtime/src/render/board-draw-model.js");
  const view = await played("first-steps", 2);
  const model = buildBoardDrawModel(view);
  assert.deepEqual(model.seatHud, view.player);
  assert.notEqual(model.seatHud, view.player, "a copy, so a client cannot mutate the view");
  assert.deepEqual(model.seatHud.vitals.map((v) => v.key), view.player.vitals.map((v) => v.key));
});

test("walls, floor, spawn and exit come through as tile kinds", async () => {
  const { buildBoardDrawModel } = await import("../../packages/runtime/src/render/board-draw-model.js");
  // No fog: every cell is in view, so the whole map's tile kinds show.
  const model = buildBoardDrawModel((await open("first-steps", false)).view());
  const kinds = new Set(model.cells.flat().map((cell) => cell.tile));
  for (const kind of ["wall", "floor", "spawn", "exit"]) assert.ok(kinds.has(kind), `no ${kind} tile`);
  assert.ok(!kinds.has("fog"), "a view without fog has no fog cells");
});

test("wall cells carry the mask behind their ASCII glyph, fog cells and non-walls carry none (#817)", async () => {
  const { buildBoardDrawModel } = await import("../../packages/runtime/src/render/board-draw-model.js");
  const { wallGlyph, WALL_NEIGHBOUR_BITS: B } = await import("../../packages/runtime/src/render/wall-glyphs.js");
  const glyphOf = (mask) => wallGlyph({ north: Boolean(mask & B.north), east: Boolean(mask & B.east), south: Boolean(mask & B.south), west: Boolean(mask & B.west) });
  for (const fog of [false, true]) {
    const session = await open("first-steps", fog);
    if (fog) for (const direction of ["north", "north", "west", "west"]) await session.act({ kind: "move", params: { direction } });
    const view = session.view();
    const model = buildBoardDrawModel(view);
    let walls = 0;
    model.cells.forEach((row, y) => row.forEach((cell, x) => {
      if (cell.tile === "wall") {
        walls += 1;
        assert.ok(Number.isInteger(cell.wallMask) && cell.wallMask >= 0 && cell.wallMask <= 15, `wall ${x},${y} has no mask`);
        assert.equal(glyphOf(cell.wallMask), view.rows[y][x], `mask at ${x},${y} disagrees with the ASCII glyph`);
      } else {
        assert.ok(!("wallMask" in cell), `${cell.tile} at ${x},${y} carries a mask`);
      }
    }));
    assert.ok(walls > 0);
    if (fog) assert.ok(model.cells.flat().some((c) => c.tile === "wall" && c.sight === "r"), "expected a remembered wall");
  }
});

test("a view that is not a play view is refused", async () => {
  const { buildBoardDrawModel } = await import("../../packages/runtime/src/render/board-draw-model.js");
  assert.throws(() => buildBoardDrawModel({}), /play-session view is required/);
});

// ## TODO: Test Permutations
// - a defeated seat (view.player null) yields seatHud null
