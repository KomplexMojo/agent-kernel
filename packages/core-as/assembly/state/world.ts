import { ValidationError } from "../validate/inputs";

export const enum Tile {
  Wall = 0,
  Floor = 1,
  Spawn = 2,
  Exit = 3,
  Barrier = 4,
}

export const enum Direction {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

export const enum ActorKind {
  Stationary = 0,
  Barrier = 1,
  Motivated = 2,
}

export const enum VitalKind {
  Health = 0,
  Mana = 1,
  Stamina = 2,
  Durability = 3,
}

const MAX_WORLD_CELLS: i32 = 1000000;
const MAX_MOTIVATED_ACTORS: i32 = 20000;
const VITAL_COUNT: i32 = 4;
const VITAL_MASK_ALL: i32 = (1 << VITAL_COUNT) - 1;
const TILE_ACTOR_ID_OFFSET: i32 = 1000;
const INVALID_TILE_ACTOR_INDEX: i32 = -1;
const BARRIER_DURABILITY_DEFAULT: i32 = 3;

let width: i32 = 0;
let height: i32 = 0;
let cellCount: i32 = 0;
let maxMotivatedActors: i32 = 0;
let tileBuffer = new StaticArray<u8>(0);
let tileBufferLength: i32 = 0;
let tiles = new StaticArray<u8>(0);
let tileActorKindByCell = new StaticArray<u8>(0);
let tileActorIdByCell = new StaticArray<i32>(0);
let tileActorIndexByCell = new StaticArray<i32>(0);
let tileActorXByIndex = new StaticArray<i32>(0);
let tileActorYByIndex = new StaticArray<i32>(0);
let tileActorKindByIndex = new StaticArray<u8>(0);
let tileActorIdByIndex = new StaticArray<i32>(0);
let tileActorDurabilityByIndex = new StaticArray<i32>(0);
let tileActorCount: i32 = 0;
let placementActorCount: i32 = 0;
let placementActorOverflow: bool = false;
let placementActorId = new StaticArray<i32>(0);
let placementActorX = new StaticArray<i32>(0);
let placementActorY = new StaticArray<i32>(0);
let motivatedOccupancyByCell = new StaticArray<i32>(0);

let spawnX: i32 = -1;
let spawnY: i32 = -1;
let exitX: i32 = -1;
let exitY: i32 = -1;

let actorId: i32 = 1;
let actorActive: bool = false;
let actorKind: ActorKind = ActorKind.Motivated;
let actorX: i32 = -1;
let actorY: i32 = -1;
let actorVitalCurrent = new StaticArray<i32>(VITAL_COUNT);
let actorVitalMax = new StaticArray<i32>(VITAL_COUNT);
let actorVitalRegen = new StaticArray<i32>(VITAL_COUNT);
let actorVitalMask: i32 = 0;
let motivatedActorCount: i32 = 0;
let motivatedActorId = new StaticArray<i32>(0);
let motivatedActorX = new StaticArray<i32>(0);
let motivatedActorY = new StaticArray<i32>(0);
let motivatedActorVitalCurrent = new StaticArray<i32>(0);
let motivatedActorVitalMax = new StaticArray<i32>(0);
let motivatedActorVitalRegen = new StaticArray<i32>(0);
let currentTick: i32 = 0;

function resizeGrid(newWidth: i32, newHeight: i32): void {
  width = newWidth;
  height = newHeight;
  cellCount = newWidth * newHeight;
  maxMotivatedActors = cellCount;
  if (maxMotivatedActors > MAX_MOTIVATED_ACTORS) {
    maxMotivatedActors = MAX_MOTIVATED_ACTORS;
  }
  tiles = new StaticArray<u8>(cellCount);
  tileActorKindByCell = new StaticArray<u8>(cellCount);
  tileActorIdByCell = new StaticArray<i32>(cellCount);
  tileActorIndexByCell = new StaticArray<i32>(cellCount);
  tileActorXByIndex = new StaticArray<i32>(cellCount);
  tileActorYByIndex = new StaticArray<i32>(cellCount);
  tileActorKindByIndex = new StaticArray<u8>(cellCount);
  tileActorIdByIndex = new StaticArray<i32>(cellCount);
  tileActorDurabilityByIndex = new StaticArray<i32>(cellCount);
  placementActorId = new StaticArray<i32>(maxMotivatedActors);
  placementActorX = new StaticArray<i32>(maxMotivatedActors);
  placementActorY = new StaticArray<i32>(maxMotivatedActors);
  motivatedOccupancyByCell = new StaticArray<i32>(cellCount);
  motivatedActorId = new StaticArray<i32>(maxMotivatedActors);
  motivatedActorX = new StaticArray<i32>(maxMotivatedActors);
  motivatedActorY = new StaticArray<i32>(maxMotivatedActors);
  motivatedActorVitalCurrent = new StaticArray<i32>(maxMotivatedActors * VITAL_COUNT);
  motivatedActorVitalMax = new StaticArray<i32>(maxMotivatedActors * VITAL_COUNT);
  motivatedActorVitalRegen = new StaticArray<i32>(maxMotivatedActors * VITAL_COUNT);
}

export function prepareTileBuffer(length: i32): usize {
  if (length <= 0) {
    return 0;
  }
  if (length > tileBufferLength) {
    tileBuffer = new StaticArray<u8>(length);
    tileBufferLength = length;
  }
  return changetype<usize>(tileBuffer);
}

export function loadTilesFromBuffer(length: i32): ValidationError {
  if (length <= 0 || length != cellCount || length > tileBufferLength) {
    return ValidationError.OutOfBounds;
  }
  let index = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = unchecked(tileBuffer[index]);
      setTile(x, y, tile as Tile);
      index += 1;
    }
  }
  return ValidationError.None;
}

function fillTiles(tile: Tile): void {
  for (let i = 0; i < cellCount; i += 1) {
    tiles[i] = tile as u8;
  }
}

function clearTileActorState(): void {
  tileActorCount = 0;
  for (let i = 0; i < cellCount; i += 1) {
    unchecked(tileActorKindByCell[i] = ActorKind.Barrier as u8);
    unchecked(tileActorIdByCell[i] = 0);
    unchecked(tileActorIndexByCell[i] = INVALID_TILE_ACTOR_INDEX);
    unchecked(tileActorXByIndex[i] = 0);
    unchecked(tileActorYByIndex[i] = 0);
    unchecked(tileActorKindByIndex[i] = ActorKind.Barrier as u8);
    unchecked(tileActorIdByIndex[i] = 0);
    unchecked(tileActorDurabilityByIndex[i] = 0);
  }
}

function clearMotivatedOccupancy(): void {
  for (let i = 0; i < cellCount; i += 1) {
    unchecked(motivatedOccupancyByCell[i] = 0);
  }
}

function setMotivatedOccupancyAt(x: i32, y: i32, value: i32): void {
  if (!withinBounds(x, y)) {
    return;
  }
  unchecked(motivatedOccupancyByCell[indexFor(x, y)] = value);
}

function seedMotivatedOccupancyFromActor(): void {
  clearMotivatedOccupancy();
  if (motivatedActorCount > 0) {
    for (let i = 0; i < motivatedActorCount; i += 1) {
      const x = unchecked(motivatedActorX[i]);
      const y = unchecked(motivatedActorY[i]);
      setMotivatedOccupancyAt(x, y, i + 1);
    }
    return;
  }
  if (actorActive) {
    setMotivatedOccupancyAt(actorX, actorY, 1);
  }
}

function resetActorPlacementsState(): void {
  placementActorCount = 0;
  placementActorOverflow = false;
  clearMotivatedOccupancy();
}

function initTileActorsForBounds(): void {
  clearTileActorState();
  let index = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = indexFor(x, y);
      const id = TILE_ACTOR_ID_OFFSET + cellIndex;
      unchecked(tileActorIndexByCell[cellIndex] = index);
      unchecked(tileActorXByIndex[index] = x);
      unchecked(tileActorYByIndex[index] = y);
      unchecked(tileActorKindByIndex[index] = ActorKind.Barrier as u8);
      unchecked(tileActorIdByIndex[index] = id);
      unchecked(tileActorDurabilityByIndex[index] = 0);
      unchecked(tileActorKindByCell[cellIndex] = ActorKind.Barrier as u8);
      unchecked(tileActorIdByCell[cellIndex] = id);
      index += 1;
    }
  }
  tileActorCount = index;
}

function setTileActorKindAtIndex(index: i32, kind: ActorKind): void {
  unchecked(tileActorKindByCell[index] = kind as u8);
  const listIndex = unchecked(tileActorIndexByCell[index]);
  if (listIndex != INVALID_TILE_ACTOR_INDEX) {
    unchecked(tileActorKindByIndex[listIndex] = kind as u8);
  }
}

function setTileDurabilityAtIndex(index: i32, value: i32): void {
  const listIndex = unchecked(tileActorIndexByCell[index]);
  if (listIndex == INVALID_TILE_ACTOR_INDEX) {
    return;
  }
  unchecked(tileActorDurabilityByIndex[listIndex] = value);
}

function durabilityForTile(tile: Tile): i32 {
  if (tile == Tile.Barrier) {
    return BARRIER_DURABILITY_DEFAULT;
  }
  return 0;
}

function actorKindForTile(tile: Tile): ActorKind {
  if (tile == Tile.Wall || tile == Tile.Barrier) {
    return ActorKind.Barrier;
  }
  return ActorKind.Stationary;
}

function fillVitals(target: StaticArray<i32>, value: i32): void {
  for (let i = 0; i < VITAL_COUNT; i += 1) {
    unchecked(target[i] = value);
  }
}

function resetActorVitals(): void {
  actorVitalMask = 0;
  fillVitals(actorVitalCurrent, 0);
  fillVitals(actorVitalMax, 0);
  fillVitals(actorVitalRegen, 0);
  if (maxMotivatedActors > 0) {
    for (let i = 0; i < VITAL_COUNT; i += 1) {
      const index = vitalIndexFor(0, i);
      unchecked(motivatedActorVitalCurrent[index] = 0);
      unchecked(motivatedActorVitalMax[index] = 0);
      unchecked(motivatedActorVitalRegen[index] = 0);
    }
  }
}

function resetMotivatedActors(): void {
  motivatedActorCount = 0;
  actorActive = false;
  actorId = 1;
  actorKind = ActorKind.Motivated;
  actorX = -1;
  actorY = -1;
  resetActorVitals();
}

function isValidVitalKind(kind: i32): bool {
  return kind >= 0 && kind < VITAL_COUNT;
}

function isValidMotivatedActorIndex(index: i32): bool {
  return index >= 0 && index < motivatedActorCount;
}

function vitalIndexFor(actorIndex: i32, kind: i32): i32 {
  return actorIndex * VITAL_COUNT + kind;
}

function indexFor(x: i32, y: i32): i32 {
  return y * width + x;
}

function resetWorldState(): void {
  spawnX = -1;
  spawnY = -1;
  exitX = -1;
  exitY = -1;
  resetMotivatedActors();
  currentTick = 0;
  fillTiles(Tile.Wall);
  clearTileActorState();
  resetActorPlacementsState();
}

export function resetWorld(): void {
  resizeGrid(0, 0);
  resetWorldState();
}

export function configureGrid(newWidth: i32, newHeight: i32): ValidationError {
  if (newWidth <= 0 || newHeight <= 0) {
    return ValidationError.OutOfBounds;
  }
  if (newWidth > MAX_WORLD_CELLS / newHeight) {
    return ValidationError.OutOfBounds;
  }
  resizeGrid(newWidth, newHeight);
  resetWorldState();
  initTileActorsForBounds();
  return ValidationError.None;
}

export function setTileAt(x: i32, y: i32, tile: i32): void {
  if (tile == Tile.Wall) {
    setTile(x, y, Tile.Wall);
    return;
  }
  if (tile == Tile.Floor) {
    setTile(x, y, Tile.Floor);
    return;
  }
  if (tile == Tile.Spawn) {
    setTile(x, y, Tile.Spawn);
    return;
  }
  if (tile == Tile.Exit) {
    setTile(x, y, Tile.Exit);
    return;
  }
  if (tile == Tile.Barrier) {
    setTile(x, y, Tile.Barrier);
  }
}

export function spawnActorAt(x: i32, y: i32): void {
  if (!withinBounds(x, y)) {
    return;
  }
  motivatedActorCount = 1;
  if (actorId <= 0) {
    actorId = 1;
  }
  unchecked(motivatedActorId[0] = actorId);
  unchecked(motivatedActorX[0] = x);
  unchecked(motivatedActorY[0] = y);
  actorActive = true;
  actorX = x;
  actorY = y;
  seedMotivatedOccupancyFromActor();
}

function setTile(x: i32, y: i32, tile: Tile): void {
  if (!withinBounds(x, y)) {
    return;
  }
  const index = indexFor(x, y);
  tiles[index] = tile as u8;
  setTileActorKindAtIndex(index, actorKindForTile(tile));
  setTileDurabilityAtIndex(index, durabilityForTile(tile));
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
  for (let x = 0; x < rowLength && x < width; x += 1) {
    const code = row.charCodeAt(x);
    if (code == 35) {
      setTile(x, y, Tile.Wall);
    } else if (code == 46) {
      setTile(x, y, Tile.Floor);
    } else if (code == 83) {
      setTile(x, y, Tile.Spawn);
    } else if (code == 69) {
      setTile(x, y, Tile.Exit);
    } else if (code == 66) {
      setTile(x, y, Tile.Barrier);
    }
  }
}

export function loadMvpWorld(): void {
  configureGrid(9, 9);
  setRowFromString(0, "#########");
  setRowFromString(1, "#S..#...#");
  setRowFromString(2, "#...#.#.#");
  setRowFromString(3, "#.#...#.#");
  setRowFromString(4, "#.###.#.#");
  setRowFromString(5, "#...#...#");
  setRowFromString(6, "#.#.#.###");
  setRowFromString(7, "#...#..E#");
  setRowFromString(8, "#########");
  actorId = 1;
  actorKind = ActorKind.Motivated;
  setActorVital(VitalKind.Health, 10, 10, 0);
  setActorVital(VitalKind.Mana, 0, 0, 0);
  setActorVital(VitalKind.Stamina, 0, 0, 0);
  setActorVital(VitalKind.Durability, 0, 0, 0);
  if (spawnX >= 0 && spawnY >= 0) {
    spawnActorAt(spawnX, spawnY);
  }
  currentTick = 0;
}

export function loadMvpBarrierWorld(): void {
  configureGrid(9, 9);
  setRowFromString(0, "#########");
  setRowFromString(1, "#SB.#...#");
  setRowFromString(2, "#...#.#.#");
  setRowFromString(3, "#.#...#.#");
  setRowFromString(4, "#.###.#.#");
  setRowFromString(5, "#...#...#");
  setRowFromString(6, "#.#.#.###");
  setRowFromString(7, "#...#..E#");
  setRowFromString(8, "#########");
  actorId = 1;
  actorKind = ActorKind.Motivated;
  setActorVital(VitalKind.Health, 10, 10, 0);
  setActorVital(VitalKind.Mana, 0, 0, 0);
  setActorVital(VitalKind.Stamina, 0, 0, 0);
  setActorVital(VitalKind.Durability, 0, 0, 0);
  if (spawnX >= 0 && spawnY >= 0) {
    spawnActorAt(spawnX, spawnY);
  }
  currentTick = 0;
}

export function withinBounds(x: i32, y: i32): bool {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function setSpawnPosition(x: i32, y: i32): void {
  spawnX = x;
  spawnY = y;
}

export function clearActorPlacements(): void {
  resetActorPlacementsState();
}

export function addActorPlacement(id: i32, x: i32, y: i32): void {
  if (placementActorCount >= maxMotivatedActors) {
    placementActorOverflow = true;
    return;
  }
  unchecked(placementActorId[placementActorCount] = id);
  unchecked(placementActorX[placementActorCount] = x);
  unchecked(placementActorY[placementActorCount] = y);
  placementActorCount += 1;
}

export function getActorPlacementCount(): i32 {
  return placementActorCount;
}

function getPlacementCount(): i32 {
  if (placementActorCount > 0) {
    return placementActorCount;
  }
  return actorActive ? 1 : 0;
}

function getPlacementId(index: i32): i32 {
  if (placementActorCount > 0) {
    return unchecked(placementActorId[index]);
  }
  return actorId;
}

function getPlacementX(index: i32): i32 {
  if (placementActorCount > 0) {
    return unchecked(placementActorX[index]);
  }
  return actorX;
}

function getPlacementY(index: i32): i32 {
  if (placementActorCount > 0) {
    return unchecked(placementActorY[index]);
  }
  return actorY;
}

export function validateActorPlacement(): ValidationError {
  const count = getPlacementCount();
  if (count <= 0) {
    return ValidationError.None;
  }
  if (placementActorOverflow || count > maxMotivatedActors) {
    return ValidationError.TooManyActors;
  }

  for (let i = 0; i < count; i += 1) {
    const x = getPlacementX(i);
    const y = getPlacementY(i);
    if (!withinBounds(x, y)) {
      return ValidationError.ActorOutOfBounds;
    }
  }

  if (spawnX >= 0 && spawnY >= 0) {
    if (getPlacementX(0) != spawnX || getPlacementY(0) != spawnY) {
      return ValidationError.ActorSpawnMismatch;
    }
  }

  clearMotivatedOccupancy();
  for (let i = 0; i < count; i += 1) {
    const x = getPlacementX(i);
    const y = getPlacementY(i);
    if (!isWalkableActorKind(getTileActorKind(x, y))) {
      return ValidationError.ActorBlocked;
    }
    const cellIndex = indexFor(x, y);
    if (unchecked(motivatedOccupancyByCell[cellIndex]) != 0) {
      return ValidationError.ActorCollision;
    }
    unchecked(motivatedOccupancyByCell[cellIndex] = i + 1);
  }

  return ValidationError.None;
}

export function applyActorPlacements(): ValidationError {
  const count = getPlacementCount();
  if (count <= 0) {
    return ValidationError.None;
  }
  if (placementActorOverflow || count > maxMotivatedActors) {
    return ValidationError.TooManyActors;
  }
  const error = validateActorPlacement();
  if (error != ValidationError.None) {
    return error;
  }
  motivatedActorCount = count;
  for (let i = 0; i < count; i += 1) {
    let id = getPlacementId(i);
    if (id <= 0) {
      id = i + 1;
    }
    unchecked(motivatedActorId[i] = id);
    unchecked(motivatedActorX[i] = getPlacementX(i));
    unchecked(motivatedActorY[i] = getPlacementY(i));
  }
  actorActive = count > 0;
  if (actorActive) {
    actorId = unchecked(motivatedActorId[0]);
    actorX = unchecked(motivatedActorX[0]);
    actorY = unchecked(motivatedActorY[0]);
  }
  resetActorVitals();
  return ValidationError.None;
}

export function getTile(x: i32, y: i32): Tile {
  if (!withinBounds(x, y)) {
    return Tile.Wall;
  }
  return unchecked(tiles[indexFor(x, y)]) as Tile;
}

export function getTileActorKind(x: i32, y: i32): ActorKind {
  if (!withinBounds(x, y)) {
    return ActorKind.Barrier;
  }
  return unchecked(tileActorKindByCell[indexFor(x, y)]) as ActorKind;
}

export function getTileActorId(x: i32, y: i32): i32 {
  if (!withinBounds(x, y)) {
    return 0;
  }
  return unchecked(tileActorIdByCell[indexFor(x, y)]);
}

export function isMotivatedOccupied(x: i32, y: i32): bool {
  if (!withinBounds(x, y)) {
    return true;
  }
  return unchecked(motivatedOccupancyByCell[indexFor(x, y)]) != 0;
}

export function getTileActorCount(): i32 {
  return tileActorCount;
}

export function getTileActorIndex(x: i32, y: i32): i32 {
  if (!withinBounds(x, y)) {
    return INVALID_TILE_ACTOR_INDEX;
  }
  return unchecked(tileActorIndexByCell[indexFor(x, y)]);
}

function isValidTileActorIndex(index: i32): bool {
  return index >= 0 && index < tileActorCount;
}

export function getTileActorXByIndex(index: i32): i32 {
  if (!isValidTileActorIndex(index)) {
    return -1;
  }
  return unchecked(tileActorXByIndex[index]);
}

export function getTileActorYByIndex(index: i32): i32 {
  if (!isValidTileActorIndex(index)) {
    return -1;
  }
  return unchecked(tileActorYByIndex[index]);
}

export function getTileActorKindByIndex(index: i32): ActorKind {
  if (!isValidTileActorIndex(index)) {
    return ActorKind.Barrier;
  }
  return unchecked(tileActorKindByIndex[index]) as ActorKind;
}

export function getTileActorIdByIndex(index: i32): i32 {
  if (!isValidTileActorIndex(index)) {
    return 0;
  }
  return unchecked(tileActorIdByIndex[index]);
}

export function getTileActorDurabilityByIndex(index: i32): i32 {
  if (!isValidTileActorIndex(index)) {
    return 0;
  }
  return unchecked(tileActorDurabilityByIndex[index]);
}

export function getTileActorDurability(x: i32, y: i32): i32 {
  const index = getTileActorIndex(x, y);
  if (index == INVALID_TILE_ACTOR_INDEX) {
    return 0;
  }
  return unchecked(tileActorDurabilityByIndex[index]);
}

export function isBarrierTile(x: i32, y: i32): bool {
  return getTile(x, y) == Tile.Barrier;
}

export function applyBarrierDurabilityDamage(x: i32, y: i32, damage: i32): i32 {
  if (!isBarrierTile(x, y)) {
    return 0;
  }
  const index = getTileActorIndex(x, y);
  if (index == INVALID_TILE_ACTOR_INDEX) {
    return 0;
  }
  const current = unchecked(tileActorDurabilityByIndex[index]);
  const next = current > damage ? current - damage : 0;
  unchecked(tileActorDurabilityByIndex[index] = next);
  return next - current;
}

export function isWalkableActorKind(kind: ActorKind): bool {
  return kind == ActorKind.Stationary;
}

export function isWalkablePosition(x: i32, y: i32): bool {
  return isWalkableActorKind(getTileActorKind(x, y));
}

export function renderBaseCell(x: i32, y: i32): i32 {
  const tile = getTile(x, y);
  if (tile == Tile.Wall) return 35;
  if (tile == Tile.Floor) return 46;
  if (tile == Tile.Spawn) return 83;
  if (tile == Tile.Exit) return 69;
  if (tile == Tile.Barrier) return 66;
  return 32;
}

export function renderCell(x: i32, y: i32): i32 {
  if (actorActive && x == actorX && y == actorY) {
    return 64; // "@"
  }
  return renderBaseCell(x, y);
}

export function hasActor(): bool {
  return actorActive || motivatedActorCount > 0;
}

export function getActorId(): i32 {
  return actorId;
}

export function getActorKind(): ActorKind {
  return actorKind;
}

export function getActorX(): i32 {
  return actorX;
}

export function getActorY(): i32 {
  return actorY;
}

export function getActorHp(): i32 {
  return getActorVitalCurrent(VitalKind.Health);
}

export function getActorMaxHp(): i32 {
  return getActorVitalMax(VitalKind.Health);
}

export function getActorVitalCurrent(kind: i32): i32 {
  if (!isValidVitalKind(kind)) {
    return 0;
  }
  return unchecked(actorVitalCurrent[kind]);
}

export function getActorVitalMax(kind: i32): i32 {
  if (!isValidVitalKind(kind)) {
    return 0;
  }
  return unchecked(actorVitalMax[kind]);
}

export function getActorVitalRegen(kind: i32): i32 {
  if (!isValidVitalKind(kind)) {
    return 0;
  }
  return unchecked(actorVitalRegen[kind]);
}

export function setActorVital(kind: i32, current: i32, max: i32, regen: i32): void {
  if (!isValidVitalKind(kind)) {
    return;
  }
  unchecked(actorVitalCurrent[kind] = current);
  unchecked(actorVitalMax[kind] = max);
  unchecked(actorVitalRegen[kind] = regen);
  if (maxMotivatedActors > 0) {
    const index = vitalIndexFor(0, kind);
    unchecked(motivatedActorVitalCurrent[index] = current);
    unchecked(motivatedActorVitalMax[index] = max);
    unchecked(motivatedActorVitalRegen[index] = regen);
  }
  actorVitalMask |= 1 << kind;
}

export function setMotivatedActorVital(index: i32, kind: i32, current: i32, max: i32, regen: i32): void {
  if (!isValidVitalKind(kind) || index < 0 || index >= motivatedActorCount) {
    return;
  }
  const offset = vitalIndexFor(index, kind);
  unchecked(motivatedActorVitalCurrent[offset] = current);
  unchecked(motivatedActorVitalMax[offset] = max);
  unchecked(motivatedActorVitalRegen[offset] = regen);
  if (index == 0) {
    unchecked(actorVitalCurrent[kind] = current);
    unchecked(actorVitalMax[kind] = max);
    unchecked(actorVitalRegen[kind] = regen);
    actorVitalMask |= 1 << kind;
  }
}

export function validateActorVitals(): ValidationError {
  if ((actorVitalMask & VITAL_MASK_ALL) != VITAL_MASK_ALL) {
    return ValidationError.MissingVital;
  }
  for (let i = 0; i < VITAL_COUNT; i += 1) {
    const current = unchecked(actorVitalCurrent[i]);
    const max = unchecked(actorVitalMax[i]);
    const regen = unchecked(actorVitalRegen[i]);
    if (current < 0 || max < 0 || regen < 0 || current > max) {
      return ValidationError.InvalidVital;
    }
  }
  return ValidationError.None;
}

export function getMotivatedActorCount(): i32 {
  return motivatedActorCount;
}

export function getMotivatedActorIdByIndex(index: i32): i32 {
  if (!isValidMotivatedActorIndex(index)) {
    return 0;
  }
  return unchecked(motivatedActorId[index]);
}

export function getMotivatedActorXByIndex(index: i32): i32 {
  if (!isValidMotivatedActorIndex(index)) {
    return -1;
  }
  return unchecked(motivatedActorX[index]);
}

export function getMotivatedActorYByIndex(index: i32): i32 {
  if (!isValidMotivatedActorIndex(index)) {
    return -1;
  }
  return unchecked(motivatedActorY[index]);
}

export function getMotivatedActorVitalCurrentByIndex(index: i32, kind: i32): i32 {
  if (!isValidMotivatedActorIndex(index) || !isValidVitalKind(kind)) {
    return 0;
  }
  return unchecked(motivatedActorVitalCurrent[vitalIndexFor(index, kind)]);
}

export function getMotivatedActorVitalMaxByIndex(index: i32, kind: i32): i32 {
  if (!isValidMotivatedActorIndex(index) || !isValidVitalKind(kind)) {
    return 0;
  }
  return unchecked(motivatedActorVitalMax[vitalIndexFor(index, kind)]);
}

export function getMotivatedActorVitalRegenByIndex(index: i32, kind: i32): i32 {
  if (!isValidMotivatedActorIndex(index) || !isValidVitalKind(kind)) {
    return 0;
  }
  return unchecked(motivatedActorVitalRegen[vitalIndexFor(index, kind)]);
}

export function setActorPosition(x: i32, y: i32): void {
  if (!withinBounds(x, y)) {
    return;
  }
  if (actorActive) {
    setMotivatedOccupancyAt(actorX, actorY, 0);
  }
  actorX = x;
  actorY = y;
  if (motivatedActorCount > 0) {
    unchecked(motivatedActorX[0] = x);
    unchecked(motivatedActorY[0] = y);
  }
  if (actorActive) {
    setMotivatedOccupancyAt(actorX, actorY, 1);
  }
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

export function validateSpawnPlacement(): ValidationError {
  if (!withinBounds(actorX, actorY)) {
    return ValidationError.OutOfBounds;
  }
  const tile = getTile(actorX, actorY);
  return tile == Tile.Spawn ? ValidationError.None : ValidationError.InvalidActionValue;
}
