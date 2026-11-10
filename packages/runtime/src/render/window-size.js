/**
 * How many tiles square the play window shows (Darren, 2026-10-30: size it from the display).
 * Always odd, so the player stands exactly in the middle, and clamped so a tiny screen still
 * shows a fight and a huge one does not show the whole level. Pure: numbers in, a number out.
 */
export const WINDOW_MIN = 7;
export const WINDOW_MAX = 15;
export const WINDOW_DEFAULT = 11;
/** Sprite size the visual version targets, in CSS px (art may be 32 or 64 px, drawn at this size). */
export const TILE_CSS_PX = 32;

const toOdd = (tiles) => Math.max(WINDOW_MIN, Math.min(WINDOW_MAX, tiles % 2 === 0 ? tiles - 1 : tiles));

/** Screens: the square board gets the width left after the gutters (an iPhone at 393 px shows 11). */
export function windowSizeForViewport({ widthPx, heightPx = Infinity, tilePx = TILE_CSS_PX, gutterPx = 16, reservedHeightPx = 350 } = {}) {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return WINDOW_DEFAULT;
  const across = Math.floor((widthPx - gutterPx) / tilePx);
  const down = Number.isFinite(heightPx) ? Math.floor((heightPx - reservedHeightPx) / tilePx) : across;
  return toOdd(Math.min(across, down));
}

/** Terminals: a tile is a glyph and a space (two columns) and the HUD takes about 16 rows. */
export function windowSizeForTerminal({ columns, rows, reservedRows = 16 } = {}) {
  if (!Number.isFinite(columns) || !Number.isFinite(rows)) return WINDOW_DEFAULT;
  return toOdd(Math.min(Math.floor((columns - 4) / 2), rows - reservedRows));
}

/**
 * The play window's bounds on a level: `windowSize` tiles square around `center` (the player, or the
 * aim cursor while aiming), clamped at the level's edge. Without a size or a centre, the whole board.
 * One rule for every client: the terminal crops its rows with it and `buildBoardFrame` its models.
 * @returns {{ x0: number, y0: number, x1: number, y1: number }} half-open: x0 <= x < x1
 */
export function playWindowBounds({ width, height, windowSize = null, center = null } = {}) {
  const size = Number.isInteger(windowSize) && windowSize > 0 && center ? windowSize : null;
  if (!size) return { x0: 0, y0: 0, x1: width, y1: height };
  const clamp = (value, max) => Math.max(0, Math.min(value, Math.max(0, max)));
  const x0 = clamp(center.x - Math.floor(size / 2), width - size);
  const y0 = clamp(center.y - Math.floor(size / 2), height - size);
  return { x0, y0, x1: Math.min(width, x0 + size), y1: Math.min(height, y0 + size) };
}
