import { test, expect } from "vitest";
import { createAllocatorPersona } from "../../../packages/runtime/src/personas/allocator/controller.js";

// #300 — `ak solve --question budget-fit` asks about the tiles a built level was billed for,
// so the Allocator publishes its own count rather than the CLI re-deriving one.
const allocator = () => createAllocatorPersona({ clock: () => "2026-10-17T00:00:00.000Z" });

test("a terrain layout is billed for its floor cells, hallways included, with no separate hallway count", () => {
  const layout = { width: 3, height: 2, terrain: ["floor", "wall", "floor", "floor", "floor", "wall"], hallwayTiles: 7 };
  expect(allocator().billedLayoutTiles(layout)).toEqual({ floorTiles: 4, hallwayTiles: 0 });
});

test("an explicit floor and hallway count is billed as given, and a budget scaffold bills nothing", () => {
  expect(allocator().billedLayoutTiles({ floorTiles: 12, hallwayTiles: 5 })).toEqual({ floorTiles: 12, hallwayTiles: 5 });
  expect(allocator().billedLayoutTiles({ floorTiles: 12, hallwayTiles: 5, budgetScaffold: true }))
    .toEqual({ floorTiles: 0, hallwayTiles: 0 });
});

// ## TODO: Test Permutations
// - a leftover `tiles` grid counts every walkable glyph except the S/E wall portals.
// - a width x height layout with no terrain or tiles bills width * height floor tiles.
