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
