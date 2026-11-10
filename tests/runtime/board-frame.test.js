// A graphical client paints one thing: the board frame. It is the controller's frame cut to the
// play window (the same window the terminal draws, following the aim cursor), with the cursor in
// window coordinates, so no client re-implements the window or draws the whole level by mistake.
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { createGameController } from "../../packages/runtime/src/controls/game-controller.js";
import { INTENT } from "../../packages/runtime/src/controls/intents.js";
import { buildBoardFrame } from "../../packages/runtime/src/render/client-surface.js";
import { playWindowBounds } from "../../packages/runtime/src/render/window-size.js";
import { createGame } from "../../packages/ui-ascii/src/game.js";
import { loadBundledLevel } from "../../packages/ui-ascii/src/levels.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/ui-ascii/levels");
const levels = (name = "first-steps") => [loadBundledLevel(name, FIXTURES)];

describe("play window bounds", () => {
  test("centred on a point, clamped at the level's edge, whole board without a size", () => {
    expect(playWindowBounds({ width: 30, height: 20, windowSize: 7, center: { x: 15, y: 10 } })).toEqual({ x0: 12, y0: 7, x1: 19, y1: 14 });
    expect(playWindowBounds({ width: 30, height: 20, windowSize: 7, center: { x: 0, y: 19 } })).toEqual({ x0: 0, y0: 13, x1: 7, y1: 20 });
    expect(playWindowBounds({ width: 5, height: 4, windowSize: 7, center: { x: 2, y: 2 } })).toEqual({ x0: 0, y0: 0, x1: 5, y1: 4 });
    expect(playWindowBounds({ width: 30, height: 20, windowSize: null, center: { x: 3, y: 3 } })).toEqual({ x0: 0, y0: 0, x1: 30, y1: 20 });
  });
});

describe("board frame", () => {
  test("is the play window, not the level, and keeps the player inside it", async () => {
    const game = await createGameController({ levels: levels(), window: 7 });
    const frame = game.frame();
    const board = buildBoardFrame(frame);
    const levelWidth = frame.view.rows[0].length;
    expect(board.levelWidth).toBe(levelWidth);
    expect(board.width).toBe(Math.min(7, levelWidth));
    expect(board.cells).toHaveLength(board.height);
    expect(board.overlay).toHaveLength(board.height);
    expect(board.cells[0]).toHaveLength(board.width);
    const seat = board.entities.find((entity) => entity.id === frame.view.player.id);
    expect(seat.x + board.origin.x).toBe(frame.view.player.position.x);
    expect(seat.y + board.origin.y).toBe(frame.view.player.position.y);
    expect(seat.x).toBeGreaterThanOrEqual(0);
    expect(seat.x).toBeLessThan(board.width);
    expect(board.cursor).toBeNull();
  });

  test("carries the aim cursor in window coordinates while aiming", async () => {
    const game = await createGameController({ levels: levels("long-way-round"), window: 7 });
    await game.handle({ type: INTENT.CAST });
    for (let i = 0; i < 9; i += 1) await game.handle({ type: INTENT.MOVE, direction: "east" });
    const frame = game.frame();
    expect(frame.aim).toBeTruthy();
    const board = buildBoardFrame(frame);
    expect(board.cursor).toEqual({ x: frame.aim.x - board.origin.x, y: frame.aim.y - board.origin.y, kind: "aim" });
    // The window follows the cursor, so it is on the board even nine tiles from the seat.
    expect(board.cursor.x).toBeGreaterThanOrEqual(0);
    expect(board.cursor.x).toBeLessThan(board.width);
    expect(board.origin.x).toBeGreaterThan(0);
  });

  test("the terminal game hands out the same frame the controller builds", async () => {
    const game = await createGame({ levels: levels() });
    expect(typeof game.frame).toBe("function");
    expect(buildBoardFrame(game.frame()).width).toBeGreaterThan(0);
  });
});

describe("pointing at a tile", () => {
  test("an adjacent tile is a step that way; a far tile with no panel does nothing", async () => {
    const game = await createGameController({ levels: levels() });
    const at = game.frame().view.player.position;
    expect(await game.pointAt({ x: at.x + 5, y: at.y + 5 })).toBe(false);
    expect(game.frame().turns).toBe(0);
    expect(await game.pointAt({ x: at.x + 1, y: at.y })).toBe(true);
    expect(game.frame().turns).toBe(1); // a turn was spent, whether the step was taken or a wall refused it
  });

  test("while aiming it moves the cursor to that tile and spends no turn", async () => {
    const game = await createGameController({ levels: levels() });
    await game.handle({ type: INTENT.CAST });
    expect(game.frame().aim).toBeTruthy();
    const at = game.frame().view.player.position;
    expect(await game.pointAt({ x: at.x + 2, y: at.y + 1 })).toBe(true);
    expect(game.frame().aim).toEqual({ x: at.x + 2, y: at.y + 1 });
    expect(game.frame().turns).toBe(0);
  });
});

// ## TODO: Test Permutations
// - pointing at a listed target in the target, inspect and watch panels selects it
// - the window follows the aim cursor to the level's edge on a level wider than the window
// - board frames on warden-hall and trap-rooms agree cell for cell with the terminal's window
