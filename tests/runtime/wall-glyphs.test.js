// Walls as connected line characters (#574): a pure function of the true wall grid.
const assert = require("node:assert/strict");
const { WALL_GLYPH_SETS, wallGlyph, wallGlyphAt, wallGlyphChars } = require("../../packages/runtime/src/render/wall-glyphs.js");

const grid = (rows) => {
  const isWall = (x, y) => rows[y]?.[x] === "#";
  const at = wallGlyphAt(rows[0].length, rows.length, isWall, "unicode");
  return rows.map((row, y) => [...row].map((c, x) => at(x, y) ?? c).join(""));
};

test("straight runs, corners, ends and an isolated wall", () => {
  assert.deepEqual(grid([
    "###.#",
    "#.#.#",
    "###.#",
    "...#.",
  ]), [
    "┌─┐.╷",
    "│.│.│",
    "└─┘.╵",
    "...■.",
  ]);
});

test("a crossing and the T-junctions around it", () => {
  assert.deepEqual(grid([
    ".#.",
    "###",
    ".#.",
  ]), [".╷.", "╶┼╴", ".╵."]);
  assert.equal(wallGlyph({ north: true, east: true, south: true }), "├");
  assert.equal(wallGlyph({ east: true, south: true, west: true }), "┬");
  assert.equal(wallGlyph({ north: true, south: true, west: true }), "┤");
  assert.equal(wallGlyph({ north: true, east: true, west: true }), "┴");
});

test("single-neighbour ends and an isolated wall have their own glyphs", () => {
  assert.equal(wallGlyph({ north: true }), "╵");
  assert.equal(wallGlyph({ east: true }), "╶");
  assert.equal(wallGlyph({ south: true }), "╷");
  assert.equal(wallGlyph({ west: true }), "╴");
  assert.equal(wallGlyph({}), "■");
});

test("outside the grid counts as no wall", () => {
  const at = wallGlyphAt(2, 1, () => true, "unicode");
  assert.equal(at(0, 0), "╶");
  assert.equal(at(1, 0), "╴");
  assert.equal(at(2, 0), null);
});

test("the ASCII set draws - | + and covers every neighbour mask", () => {
  assert.equal(wallGlyph({ east: true, west: true }, "ascii"), "-");
  assert.equal(wallGlyph({ north: true, south: true }, "ascii"), "|");
  assert.equal(wallGlyph({ east: true, south: true }, "ascii"), "+");
  assert.equal(wallGlyph({ north: true, east: true, south: true, west: true }, "ascii"), "+");
  for (const set of Object.values(WALL_GLYPH_SETS)) assert.equal(Object.keys(set).length, 16);
  assert.ok(wallGlyphChars("ascii").every((char) => "-|+".includes(char)));
});
