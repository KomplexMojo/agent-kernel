import { ValidationError } from "../validate/inputs";

export const enum Tile {
  Wall = 0,
  Floor = 1,
  Spawn = 2,
  Exit = 3,
}

export const enum Direction {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

const MAX_WIDTH: i32 = 8;
const MAX_HEIGHT: i32 = 8;
const STRIDE: i32 = MAX_WIDTH;
const MAX_CELLS: i32 = MAX_WIDTH * MAX_HEIGHT;

let width: i32 = 0;
let height: i32 = 0;
let tiles = new StaticArray<u8>(MAX_CELLS);

let spawnX: i32 = -1;
let spawnY: i32 = -1;
let exitX: i32 = -1;
let exitY: i32 = -1;

let actorId: i32 = 1;
let actorActive: bool = false;
let actorX: i32 = -1;
let actorY: i32 = -1;
let actorHp: i32 = 0;
let actorMaxHp: i32 = 0;
let currentTick: i32 = 0;

function fillTiles(tile: Tile): void {
  for (let i = 0; i < MAX_CELLS; i += 1) {
    tiles[i] = tile as u8;
  }
}

function indexFor(x: i32, y: i32): i32 {
  return y * STRIDE + x;
}

export function resetWorld(): void {
  width = 0;
  height = 0;
  spawnX = -1;
  spawnY = -1;
  exitX = -1;
  exitY = -1;
  actorId = 1;
  actorActive = false;
  actorX = -1;
  actorY = -1;
  actorHp = 0;
  actorMaxHp = 0;
  currentTick = 0;
  fillTiles(Tile.Wall);
}

function setTile(x: i32, y: i32, tile: Tile): void {
  if (!withinBounds(x, y)) {
    return;
  }
  tiles[indexFor(x, y)] = tile as u8;
  if (tile == Tile.Spawn) {
    spawnX = x;
    spawnY = y;
  } else if (tile == Tile.Exit) {
    exitX = x;
    exitY = y;
  }
}

function setRowFromString(y: i32, row: string): void {
  const rowLength = row.length;
  for (let x = 0; x < rowLength && x < MAX_WIDTH; x += 1) {
    const code = row.charCodeAt(x);
    if (code == 35) {
      setTile(x, y, Tile.Wall);
    } else if (code == 46) {
      setTile(x, y, Tile.Floor);
    } else if (code == 83) {
      setTile(x, y, Tile.Spawn);
    } else if (code == 69) {
      setTile(x, y, Tile.Exit);
    }
  }
}

export function loadMvpWorld(): void {
  resetWorld();
  width = 5;
  height = 5;
  setRowFromString(0, "#####");
  setRowFromString(1, "#S..#");
  setRowFromString(2, "#.#E#");
  setRowFromString(3, "#...#");
  setRowFromString(4, "#####");
  actorId = 1;
  actorHp = 10;
  actorMaxHp = 10;
  if (spawnX >= 0 && spawnY >= 0) {
    actorX = spawnX;
    actorY = spawnY;
    actorActive = true;
  }
  currentTick = 0;
}

export function withinBounds(x: i32, y: i32): bool {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function getTile(x: i32, y: i32): Tile {
  if (!withinBounds(x, y)) {
    return Tile.Wall;
  }
  return unchecked(tiles[indexFor(x, y)]) as Tile;
}

export function isWalkableTile(tile: Tile): bool {
  return tile != Tile.Wall;
}

export function renderBaseCell(x: i32, y: i32): i32 {
  const tile = getTile(x, y);
  if (tile == Tile.Wall) return 35;
  if (tile == Tile.Floor) return 46;
  if (tile == Tile.Spawn) return 83;
  if (tile == Tile.Exit) return 69;
  return 32;
}

export function renderCell(x: i32, y: i32): i32 {
  if (actorActive && x == actorX && y == actorY) {
    return 64; // "@"
  }
  return renderBaseCell(x, y);
}

export function hasActor(): bool {
  return actorActive;
}

export function getActorId(): i32 {
  return actorId;
}

export function getActorX(): i32 {
  return actorX;
}

export function getActorY(): i32 {
  return actorY;
}

export function getActorHp(): i32 {
  return actorHp;
}

export function getActorMaxHp(): i32 {
  return actorMaxHp;
}

export function setActorPosition(x: i32, y: i32): void {
  if (!withinBounds(x, y)) {
    return;
  }
  actorX = x;
  actorY = y;
}

export function setCurrentTick(value: i32): void {
  currentTick = value;
}

export function getCurrentTick(): i32 {
  return currentTick;
}

export function getMapWidth(): i32 {
  return width;
}

export function getMapHeight(): i32 {
  return height;
}

export function isActorAtExit(): bool {
  if (!actorActive) return false;
  return actorX == exitX && actorY == exitY;
}

export function encodePosition(x: i32, y: i32): i32 {
  return (y << 16) | (x & 0xffff);
}

export function validateSpawnPlacement(): ValidationError {
  if (!withinBounds(actorX, actorY)) {
    return ValidationError.OutOfBounds;
  }
  const tile = getTile(actorX, actorY);
  return tile == Tile.Spawn ? ValidationError.None : ValidationError.InvalidActionValue;
}
