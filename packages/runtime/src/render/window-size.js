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
