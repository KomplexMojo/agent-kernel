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

test("wallMaskAt is the neighbour rule behind wallGlyphAt, with the published bit layout (#817)", async () => {
  const { wallMaskAt, wallMask, WALL_NEIGHBOUR_BITS } = await import("../../packages/runtime/src/render/wall-glyphs.js");
  assert.deepEqual({ ...WALL_NEIGHBOUR_BITS }, { north: 1, east: 2, south: 4, west: 8 });
  assert.equal(wallMask({ north: true, west: true }), 9);
  const grid = [".#.", "###", ".#."];
  const isWall = (x, y) => grid[y][x] === "#";
  const mask = wallMaskAt(3, 3, isWall);
  const glyph = wallGlyphAt(3, 3, isWall);
  assert.equal(mask(1, 1), 15);
  assert.equal(mask(0, 0), null);
  assert.equal(mask(1, 0), 4);
  assert.equal(mask(0, 1), 2);
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) assert.equal(mask(x, y) === null, glyph(x, y) === null);
  assert.equal(wallMaskAt(1, 1, () => true)(0, 0), 0, "an isolated wall has mask 0");
});

test("wall blob masks (#829): outside is wall, orphan diagonals drop, 47 slots", async () => {
  const { wallBlobMaskAt, wallBlobSlot, WALL_BLOB_MASKS, WALL_BLOB_BITS } = await import("../../packages/runtime/src/render/wall-glyphs.js");
  assert.equal(WALL_BLOB_MASKS.length, 47);
  assert.deepEqual({ ...WALL_BLOB_BITS }, { north: 1, northEast: 2, east: 4, southEast: 8, south: 16, southWest: 32, west: 64, northWest: 128 });
  // A 5x5 level with a ring of wall around a carved room: the four corners' known atlas slots.
  const ring = (x, y) => x === 0 || y === 0 || x === 4 || y === 4;
  const at = wallBlobMaskAt(5, 5, ring);
  assert.deepEqual([[0, 0], [4, 0], [0, 4], [4, 4]].map(([x, y]) => wallBlobSlot(at(x, y))), [44, 41, 45, 33]);
  assert.equal(at(2, 2), null, "floor carries no mask");
  // Outside the grid counts as wall: a border wall beside floor still sees wall on its outer side.
  assert.equal(at(2, 0) & 1, 1);
  // Orphan diagonal: wall at NE with floor to its north and east reduces away.
  const lone = wallBlobMaskAt(3, 3, (x, y) => (x === 1 && y === 1) || (x === 2 && y === 0));
  assert.equal(lone(1, 1) & WALL_BLOB_BITS.northEast, 0);
});
