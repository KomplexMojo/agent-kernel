// World state — the tile grid, and the spawn and exit portals on it.
// No IO, no imports outside core-ts.
//
// #227 — the actor, hazard and resource state that used to live here (with the
// affinity field, light levels, visibility radius, exit dwell, upkeep and the
// per-tick regen built on it) was removed once nothing could seat an actor in
// this world. Actors, hazards and their fields now live in the actor registry
// (`state/actor-registry.ts`) and the `rules/actor-*` modules.

import { ValidationError } from "../validate/inputs.ts";

// ── Tile codes ──

export const Tile = {
  Wall: 0,
  Floor: 1,
  Spawn: 2,
  Exit: 3,
  Barrier: 4,
} as const;

// ── Constants ──

const MAX_WORLD_CELLS = 1_000_000;

// ══════════════════════════════════════════════════════════════════════════════
// createWorldState — all world state lives inside this closure
// ══════════════════════════════════════════════════════════════════════════════

export function createWorldState() {
  // ── Grid geometry ──
  let width = 0;
  let height = 0;
  let cellCount = 0;

  // ── Tile buffer (for loadTilesFromBuffer) ──
  let tileBuffer = new Uint8Array(0);
  let tileBufferLength = 0;

  // ── Per-cell tiles ──
  let tiles = new Uint8Array(0);

  // ── Spawn and exit (wall portals) + interior approach floors ──
  let spawnX = -1;
  let spawnY = -1;
  let exitX = -1;
  let exitY = -1;
  let spawnApproachX = -1;
  let spawnApproachY = -1;
  let exitApproachX = -1;
  let exitApproachY = -1;

  // ── Index helpers ──

  function indexFor(x: number, y: number): number {
    return y * width + x;
  }

  function withinBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < width && y < height;
  }

  // ── Grid allocation ──

  function resizeGrid(newWidth: number, newHeight: number): void {
    width = newWidth;
    height = newHeight;
    cellCount = newWidth * newHeight;
    tiles = new Uint8Array(cellCount);
  }

  // ── Tile placement (private) ──

  function setTile(x: number, y: number, tile: number): void {
    if (!withinBounds(x, y)) return;
    tiles[indexFor(x, y)] = tile;
    if (tile === Tile.Spawn) {
      spawnX = x;
      spawnY = y;
    } else if (tile === Tile.Exit) {
      exitX = x;
      exitY = y;
    }
  }

  function getTileLocal(x: number, y: number): number {
    if (!withinBounds(x, y)) return Tile.Wall;
    return tiles[indexFor(x, y)];
  }

  // ── World reset ──

  function resetWorldState(): void {
    spawnX = -1;
    spawnY = -1;
    exitX = -1;
    exitY = -1;
    spawnApproachX = -1;
    spawnApproachY = -1;
    exitApproachX = -1;
    exitApproachY = -1;
    tiles.fill(Tile.Wall);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════════════

  return {
    // ── Grid configuration ──

    configureGrid(newWidth: number, newHeight: number): number {
      if (newWidth <= 0 || newHeight <= 0) return ValidationError.OutOfBounds;
      if (newWidth > MAX_WORLD_CELLS / newHeight) return ValidationError.OutOfBounds;
      resizeGrid(newWidth, newHeight);
      resetWorldState();
      return ValidationError.None;
    },

    getMapWidth: () => width,
    getMapHeight: () => height,

    // ── Tile buffer ──

    prepareTileBuffer(length: number): number {
      if (length <= 0) return 0;
      if (length > tileBufferLength) {
        tileBuffer = new Uint8Array(length);
        tileBufferLength = length;
      }
      // Return a dummy pointer because the TypeScript core keeps the tile buffer in memory.
      return 1;
    },

    loadTilesFromBuffer(length: number): number {
      if (length <= 0 || length !== cellCount || length > tileBufferLength) {
        return ValidationError.OutOfBounds;
      }
      let idx = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          setTile(x, y, tileBuffer[idx]);
          idx++;
        }
      }
      return ValidationError.None;
    },

    // ── Tile placement ──

    setTileAt(x: number, y: number, tile: number): void {
      if (tile === Tile.Wall) setTile(x, y, Tile.Wall);
      else if (tile === Tile.Floor) setTile(x, y, Tile.Floor);
      else if (tile === Tile.Spawn) setTile(x, y, Tile.Spawn);
      else if (tile === Tile.Exit) setTile(x, y, Tile.Exit);
      else if (tile === Tile.Barrier) setTile(x, y, Tile.Barrier);
    },

    // ── Spawn / exit ──

    setSpawnPosition(x: number, y: number): void {
      spawnX = x;
      spawnY = y;
    },

    setExitPosition(x: number, y: number): void {
      exitX = x;
      exitY = y;
    },

    setSpawnApproachPosition(x: number, y: number): void {
      spawnApproachX = x;
      spawnApproachY = y;
    },

    setExitApproachPosition(x: number, y: number): void {
      exitApproachX = x;
      exitApproachY = y;
    },

    getSpawnApproachPosition(): { x: number; y: number } {
      return { x: spawnApproachX, y: spawnApproachY };
    },

    getExitApproachPosition(): { x: number; y: number } {
      return { x: exitApproachX, y: exitApproachY };
    },

    // ── Bounds and queries ──

    withinBounds,

    /** Floor is the only walkable tile; spawn and exit are wall portals. */
    isWalkablePosition(x: number, y: number): boolean {
      return getTileLocal(x, y) === Tile.Floor;
    },

    // ── Rendering ──

    renderBaseCellChar(x: number, y: number): number {
      const tile = getTileLocal(x, y);
      if (tile === Tile.Wall) return 35;
      if (tile === Tile.Floor) return 46;
      if (tile === Tile.Spawn) return 83;
      if (tile === Tile.Exit) return 69;
      if (tile === Tile.Barrier) return 66;
      return 32;
    },
  };
}
