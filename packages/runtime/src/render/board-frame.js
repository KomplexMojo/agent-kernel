/**
 * Board frame: the one thing a graphical client paints. It is the game controller's `frame()` cut
 * to the play window (`playWindowBounds`, the window the terminal draws: around the player, or
 * around the aim cursor while aiming), with every coordinate in window space.
 *
 * Pure: it reads the frame only. The draw model and the affinity overlay it crops are the full-level
 * projections of the fog-masked view, so the frame reveals nothing the terminal does not.
 *
 * @module board-frame
 */

import { buildBoardDrawModel } from "./board-draw-model.js";
import { buildAffinityBoardOverlayModel } from "./affinity-overlay-model.js";
import { playWindowBounds } from "./window-size.js";

/** What the open panel's cursor means: where a cast or a barrier will go, or who is picked. */
function cursorOf(frame) {
  const panel = frame.panel;
  if (frame.aim) return { ...frame.aim, kind: panel?.raise ? "raise" : "aim" };
  if (panel?.type !== "target") return null;
  const at = panel.items?.[panel.index]?.position;
  return at ? { x: at.x, y: at.y, kind: panel.inspect ? "inspect" : panel.watch ? "watch" : "target" } : null;
}

/**
 * @param {object} frame  what `createGameController().frame()` (or the terminal game's `frame()`) returns
 * @returns {{ origin: {x: number, y: number}, width: number, height: number, levelWidth: number,
 *   levelHeight: number, cells: object[][], overlay: object[][], entities: object[],
 *   cursor: {x: number, y: number, kind: string}|null, seatHud: object|null }}
 *   `cells[y][x]` is a draw-model cell and `overlay[y][x]` the affinity overlay cell for the same
 *   tile. `entities` are the draw model's, inside the window only. `origin` is the window's top-left
 *   on the level: a tapped window tile `(x, y)` is level tile `(x + origin.x, y + origin.y)`, which is
 *   what the controller's `pointAt` takes. `cursor` is null when no panel points at a tile, and may
 *   lie outside the window only if the window is smaller than one tile.
 */
export function buildBoardFrame(frame) {
  if (!frame?.view) throw new Error("buildBoardFrame: a game controller frame is required");
  const draw = buildBoardDrawModel(frame.view);
  const overlay = buildAffinityBoardOverlayModel(frame.view);
  const cursor = cursorOf(frame);
  const center = frame.aim ?? frame.view.player?.position ?? null;
  const { x0, y0, x1, y1 } = playWindowBounds({ width: draw.width, height: draw.height, windowSize: frame.windowSize, center });
  const crop = (rows) => rows.slice(y0, y1).map((row) => row.slice(x0, x1));
  return {
    origin: { x: x0, y: y0 },
    width: x1 - x0,
    height: y1 - y0,
    levelWidth: draw.width,
    levelHeight: draw.height,
    cells: crop(draw.cells),
    overlay: crop(overlay.cells),
    entities: draw.entities.filter((entity) => entity.x >= x0 && entity.x < x1 && entity.y >= y0 && entity.y < y1)
      .map((entity) => ({ ...entity, x: entity.x - x0, y: entity.y - y0 })),
    cursor: cursor ? { x: cursor.x - x0, y: cursor.y - y0, kind: cursor.kind } : null,
    seatHud: draw.seatHud,
  };
}
