/**
 * Walls as connected line characters (#574). The glyph for a wall cell is a pure function
 * of which of its four neighbours are walls in the true level grid, so a wall seen under
 * fog still joins to a neighbour that is not in sight. Outside the grid counts as no wall.
 *
 * Two sets: Unicode box-drawing (default) and an ASCII fallback (`- | +`) for terminals and
 * fonts without box-drawing, chosen by the UI's switch and passed in as `set`.
 */

// Neighbour bits: north 1, east 2, south 4, west 8.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** The bit layout of a wall mask (#817), for clients that pick art by connectivity. */
export const WALL_NEIGHBOUR_BITS = Object.freeze({ north: N, east: E, south: S, west: W });

/**
 * The bit layout of a wall blob mask (#829): eight neighbours, for 47-face blob atlases.
 * Unlike `wallMask`, outside the level counts as wall (rooms are carved from solid fill), and a
 * diagonal bit survives only when both cardinals beside it are wall (orphan corners are dropped).
 */
export const WALL_BLOB_BITS = Object.freeze({ north: 1, northEast: 2, east: 4, southEast: 8, south: 16, southWest: 32, west: 64, northWest: 128 });

/** The 47 reduced blob masks in ascending order; a mask's index here is its atlas slot. */
export const WALL_BLOB_MASKS = Object.freeze(reducedBlobMasks());

function reduceBlob(m) {
  const B = WALL_BLOB_BITS;
  let r = m & (B.north | B.east | B.south | B.west);
  if ((m & B.northEast) && (m & B.north) && (m & B.east)) r |= B.northEast;
  if ((m & B.southEast) && (m & B.south) && (m & B.east)) r |= B.southEast;
  if ((m & B.southWest) && (m & B.south) && (m & B.west)) r |= B.southWest;
  if ((m & B.northWest) && (m & B.north) && (m & B.west)) r |= B.northWest;
  return r;
}

function reducedBlobMasks() {
  return [...new Set(Array.from({ length: 256 }, (_, m) => reduceBlob(m)))].sort((a, b) => a - b);
}

/** The atlas slot (0..46) of a reduced blob mask. */
export function wallBlobSlot(mask) {
  return WALL_BLOB_MASKS.indexOf(reduceBlob(mask));
}

/**
 * The reduced 0..255 blob mask for every wall cell of a grid (#829), from the true grid, so a window
 * cropped from it keeps full-level connectivity. Outside the grid counts as wall.
 *
 * @returns {(x: number, y: number) => number | null} the mask at a cell, null where it is not a wall
 */
export function wallBlobMaskAt(width, height, isWall) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const wall = (x, y) => !inside(x, y) || Boolean(isWall(x, y));
  return (x, y) => {
    if (!inside(x, y) || !isWall(x, y)) return null;
    let m = 0;
    if (wall(x, y - 1)) m |= 1;
    if (wall(x + 1, y - 1)) m |= 2;
    if (wall(x + 1, y)) m |= 4;
    if (wall(x + 1, y + 1)) m |= 8;
    if (wall(x, y + 1)) m |= 16;
    if (wall(x - 1, y + 1)) m |= 32;
    if (wall(x - 1, y)) m |= 64;
    if (wall(x - 1, y - 1)) m |= 128;
    return reduceBlob(m);
  };
}

export const WALL_GLYPH_SETS = Object.freeze({
  unicode: Object.freeze({
    0: "■", [N]: "╵", [E]: "╶", [S]: "╷", [W]: "╴",
    [N | S]: "│", [E | W]: "─",
    [N | E]: "└", [E | S]: "┌", [S | W]: "┐", [N | W]: "┘",
    [N | E | S]: "├", [N | S | W]: "┤", [E | S | W]: "┬", [N | E | W]: "┴",
    [N | E | S | W]: "┼",
  }),
  ascii: Object.freeze({
    0: "+", [N]: "|", [E]: "-", [S]: "|", [W]: "-",
    [N | S]: "|", [E | W]: "-",
    [N | E]: "+", [E | S]: "+", [S | W]: "+", [N | W]: "+",
    [N | E | S]: "+", [N | S | W]: "+", [E | S | W]: "+", [N | E | W]: "+",
    [N | E | S | W]: "+",
  }),
});

/** Every character a set can draw, for UIs that style by character. */
export function wallGlyphChars(set = "unicode") {
  return [...new Set(Object.values(WALL_GLYPH_SETS[set] ?? WALL_GLYPH_SETS.unicode))];
}

/** The glyph for a wall whose neighbours are `{ north, east, south, west }` (booleans). */
export function wallGlyph({ north = false, east = false, south = false, west = false } = {}, set = "unicode") {
  const glyphs = WALL_GLYPH_SETS[set] ?? WALL_GLYPH_SETS.unicode;
  return glyphs[(north ? N : 0) | (east ? E : 0) | (south ? S : 0) | (west ? W : 0)];
}

/** The 0..15 connectivity mask of a wall whose neighbours are `{ north, east, south, west }` (booleans). */
export function wallMask({ north = false, east = false, south = false, west = false } = {}) {
  return (north ? N : 0) | (east ? E : 0) | (south ? S : 0) | (west ? W : 0);
}

/**
 * The mask for every wall cell of a grid, from the same true-grid neighbour rule as `wallGlyphAt`.
 *
 * @returns {(x: number, y: number) => number | null} the mask at a cell, null where it is not a wall
 */
export function wallMaskAt(width, height, isWall) {
  const wall = (x, y) => x >= 0 && y >= 0 && x < width && y < height && Boolean(isWall(x, y));
  return (x, y) => (wall(x, y)
    ? wallMask({ north: wall(x, y - 1), east: wall(x + 1, y), south: wall(x, y + 1), west: wall(x - 1, y) })
    : null);
}

/**
 * The glyph for every wall cell of a grid.
 *
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => boolean} isWall the true level grid
 * @param {string} [set] "unicode" or "ascii"
 * @returns {(x: number, y: number) => string | null} the glyph at a cell, null where it is not a wall
 */
export function wallGlyphAt(width, height, isWall, set = "unicode") {
  const wall = (x, y) => x >= 0 && y >= 0 && x < width && y < height && Boolean(isWall(x, y));
  return (x, y) => (wall(x, y)
    ? wallGlyph({ north: wall(x, y - 1), east: wall(x + 1, y), south: wall(x, y + 1), west: wall(x - 1, y) }, set)
    : null);
}
