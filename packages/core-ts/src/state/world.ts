// World state — grid, tiles, actors, motivated actors, hazards, resources, affinity field.
// Ported from packages/core-ts/src/state/world.ts (1618 lines).
// No IO, no imports outside core-ts.

import { ValidationError } from "../validate/inputs.ts";
import {
  getOppositeAffinityKind,
  isValidAffinityKind,
  isValidAffinityExpression,
} from "./affinity.ts";
import { computeAffinityRadius, computeAffinityIntensity } from "./affinity-spatial.ts";
import { VitalKind } from "./vitals.ts";

// ── Tile codes ──

export const Tile = {
  Wall: 0,
  Floor: 1,
  Spawn: 2,
  Exit: 3,
  Barrier: 4,
} as const;

// ── Actor kind codes ──

export const ActorKind = {
  Stationary: 0,
  Barrier: 1,
  Motivated: 2,
} as const;

// ── Constants ──

const MAX_WORLD_CELLS = 1_000_000;
const MAX_MOTIVATED_ACTORS = 20_000;
const VITAL_COUNT = 4;
const VITAL_MASK_ALL = (1 << VITAL_COUNT) - 1;
const TILE_ACTOR_ID_OFFSET = 1000;
const INVALID_TILE_ACTOR_INDEX = -1;
const BARRIER_DURABILITY_DEFAULT = 3;
const DEFAULT_MOVEMENT_COST = 1;
const DEFAULT_ACTION_COST_MANA = 0;
const DEFAULT_ACTION_COST_STAMINA = 0;
const STATIC_HAZARD_NONE = 0;
const RESOURCE_VITAL_NONE = -1;
const AFFINITY_KIND_COUNT = 10;

// ══════════════════════════════════════════════════════════════════════════════
// createWorldState — all world state lives inside this closure
// ══════════════════════════════════════════════════════════════════════════════

export function createWorldState() {
  // ── Grid geometry ──
  let width = 0;
  let height = 0;
  let cellCount = 0;
  let maxMotivatedActors = 0;

  // ── Tile buffer (for loadTilesFromBuffer) ──
  let tileBuffer = new Uint8Array(0);
  let tileBufferLength = 0;

  // ── Per-cell arrays ──
  let tiles = new Uint8Array(0);
  let tileActorKindByCell = new Uint8Array(0);
  let tileActorIdByCell = new Int32Array(0);
  let tileActorIndexByCell = new Int32Array(0);
  let tileActorXByIndex = new Int32Array(0);
  let tileActorYByIndex = new Int32Array(0);
  let tileActorKindByIndex = new Uint8Array(0);
  let tileActorIdByIndex = new Int32Array(0);
  let tileActorDurabilityByIndex = new Int32Array(0);
  let tileActorCount = 0;

  // ── Static hazards ──
  let staticHazardAffinityByCell = new Int32Array(0);
  let staticHazardExpressionByCell = new Int32Array(0);
  let staticHazardStacksByCell = new Int32Array(0);
  let staticHazardManaReserveByCell = new Int32Array(0);
  let staticHazardManaMaxByCell = new Int32Array(0);
  let staticHazardManaRegenByCell = new Int32Array(0);
  let staticHazardDurabilityCurrentByCell = new Int32Array(0);
  let staticHazardDurabilityMaxByCell = new Int32Array(0);
  let staticHazardDurabilityRegenByCell = new Int32Array(0);
  let staticHazardCount = 0;

  // ── Resources ──
  let resourceVitalKindByCell = new Int32Array(0);
  let resourceDeltaByCell = new Int32Array(0);
  let resourceModeByCell = new Int32Array(0);
  let resourceCount = 0;

  // ── Actor placements ──
  let placementActorCount = 0;
  let placementActorOverflow = false;
  let placementActorId = new Int32Array(0);
  let placementActorX = new Int32Array(0);
  let placementActorY = new Int32Array(0);

  // ── Motivated occupancy ──
  let motivatedOccupancyByCell = new Int32Array(0);

  // ── Affinity field buffers ──
  let affinityFieldIntensity = new Float64Array(0);
  let affinityFieldStacks = new Int32Array(0);
  let affinityFieldExpression = new Int32Array(0);
  let affinityFieldContribCount = new Int32Array(0);

  // ── Spawn and exit ──
  let spawnX = -1;
  let spawnY = -1;
  let exitX = -1;
  let exitY = -1;

  // ── Active actor state (mirror of motivated actor at activeMotivatedActorIndex) ──
  let actorId = 1;
  let actorActive = false;
  let actorKind = ActorKind.Motivated;
  let actorX = -1;
  let actorY = -1;
  const actorVitalCurrent = new Int32Array(VITAL_COUNT);
  const actorVitalMax = new Int32Array(VITAL_COUNT);
  const actorVitalRegen = new Int32Array(VITAL_COUNT);
  let actorVitalMask = 0;
  let actorMovementCost = DEFAULT_MOVEMENT_COST;
  let actorActionCostMana = DEFAULT_ACTION_COST_MANA;
  let actorActionCostStamina = DEFAULT_ACTION_COST_STAMINA;

  // ── Motivated actors ──
  let motivatedActorCount = 0;
  let motivatedActorIdArr = new Int32Array(0);
  let motivatedActorXArr = new Int32Array(0);
  let motivatedActorYArr = new Int32Array(0);
  let motivatedActorVitalCurrent = new Int32Array(0);
  let motivatedActorVitalMax = new Int32Array(0);
  let motivatedActorVitalRegen = new Int32Array(0);
  let motivatedActorMovementCostArr = new Int32Array(0);
  let motivatedActorActionCostManaArr = new Int32Array(0);
  let motivatedActorActionCostStaminaArr = new Int32Array(0);
  let motivatedActorAffinityKindArr = new Int32Array(0);
  let motivatedActorAffinityExpressionArr = new Int32Array(0);
  let motivatedActorAffinityStacksArr = new Int32Array(0);
  let activeMotivatedActorIndex = 0;
  let currentTick = 0;

  // ── Index helpers ──

  function indexFor(x: number, y: number): number {
    return y * width + x;
  }

  function vitalIndexFor(actorIndex: number, kind: number): number {
    return actorIndex * VITAL_COUNT + kind;
  }

  function withinBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < width && y < height;
  }

  // ── Grid allocation ──

  function resizeGrid(newWidth: number, newHeight: number): void {
    width = newWidth;
    height = newHeight;
    cellCount = newWidth * newHeight;
    maxMotivatedActors = Math.min(cellCount, MAX_MOTIVATED_ACTORS);

    tiles = new Uint8Array(cellCount);
    tileActorKindByCell = new Uint8Array(cellCount);
    tileActorIdByCell = new Int32Array(cellCount);
    tileActorIndexByCell = new Int32Array(cellCount);
    tileActorXByIndex = new Int32Array(cellCount);
    tileActorYByIndex = new Int32Array(cellCount);
    tileActorKindByIndex = new Uint8Array(cellCount);
    tileActorIdByIndex = new Int32Array(cellCount);
    tileActorDurabilityByIndex = new Int32Array(cellCount);
    staticHazardAffinityByCell = new Int32Array(cellCount);
    staticHazardExpressionByCell = new Int32Array(cellCount);
    staticHazardStacksByCell = new Int32Array(cellCount);
    staticHazardManaReserveByCell = new Int32Array(cellCount);
    staticHazardManaMaxByCell = new Int32Array(cellCount);
    staticHazardManaRegenByCell = new Int32Array(cellCount);
    staticHazardDurabilityCurrentByCell = new Int32Array(cellCount);
    staticHazardDurabilityMaxByCell = new Int32Array(cellCount);
    staticHazardDurabilityRegenByCell = new Int32Array(cellCount);
    resourceVitalKindByCell = new Int32Array(cellCount);
    resourceDeltaByCell = new Int32Array(cellCount);
    resourceModeByCell = new Int32Array(cellCount);
    placementActorId = new Int32Array(maxMotivatedActors);
    placementActorX = new Int32Array(maxMotivatedActors);
    placementActorY = new Int32Array(maxMotivatedActors);
    motivatedOccupancyByCell = new Int32Array(cellCount);
    motivatedActorIdArr = new Int32Array(maxMotivatedActors);
    motivatedActorXArr = new Int32Array(maxMotivatedActors);
    motivatedActorYArr = new Int32Array(maxMotivatedActors);
    motivatedActorVitalCurrent = new Int32Array(maxMotivatedActors * VITAL_COUNT);
    motivatedActorVitalMax = new Int32Array(maxMotivatedActors * VITAL_COUNT);
    motivatedActorVitalRegen = new Int32Array(maxMotivatedActors * VITAL_COUNT);
    motivatedActorMovementCostArr = new Int32Array(maxMotivatedActors);
    motivatedActorActionCostManaArr = new Int32Array(maxMotivatedActors);
    motivatedActorActionCostStaminaArr = new Int32Array(maxMotivatedActors);
    motivatedActorAffinityKindArr = new Int32Array(maxMotivatedActors);
    motivatedActorAffinityExpressionArr = new Int32Array(maxMotivatedActors);
    motivatedActorAffinityStacksArr = new Int32Array(maxMotivatedActors);

    const fieldSize = AFFINITY_KIND_COUNT * cellCount;
    affinityFieldIntensity = new Float64Array(fieldSize);
    affinityFieldStacks = new Int32Array(fieldSize);
    affinityFieldExpression = new Int32Array(fieldSize);
    affinityFieldContribCount = new Int32Array(fieldSize);
  }

  // ── Tile helpers ──

  function fillTiles(tile: number): void {
    tiles.fill(tile);
  }

  function actorKindForTile(tile: number): number {
    if (tile === Tile.Wall || tile === Tile.Barrier) return ActorKind.Barrier;
    return ActorKind.Stationary;
  }

  function durabilityForTile(tile: number): number {
    return tile === Tile.Barrier ? BARRIER_DURABILITY_DEFAULT : 0;
  }

  function isWalkableActorKindLocal(kind: number): boolean {
    return kind === ActorKind.Stationary;
  }

  // ── Tile actor state ──

  function clearTileActorState(): void {
    tileActorCount = 0;
    for (let i = 0; i < cellCount; i++) {
      tileActorKindByCell[i] = ActorKind.Barrier;
      tileActorIdByCell[i] = 0;
      tileActorIndexByCell[i] = INVALID_TILE_ACTOR_INDEX;
      tileActorXByIndex[i] = 0;
      tileActorYByIndex[i] = 0;
      tileActorKindByIndex[i] = ActorKind.Barrier;
      tileActorIdByIndex[i] = 0;
      tileActorDurabilityByIndex[i] = 0;
    }
  }

  function setTileActorKindAtIndex(index: number, kind: number): void {
    tileActorKindByCell[index] = kind;
    const listIndex = tileActorIndexByCell[index];
    if (listIndex !== INVALID_TILE_ACTOR_INDEX) {
      tileActorKindByIndex[listIndex] = kind;
    }
  }

  function setTileDurabilityAtIndex(index: number, value: number): void {
    const listIndex = tileActorIndexByCell[index];
    if (listIndex === INVALID_TILE_ACTOR_INDEX) return;
    tileActorDurabilityByIndex[listIndex] = value;
  }

  function initTileActorsForBounds(): void {
    clearTileActorState();
    let index = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ci = indexFor(x, y);
        const id = TILE_ACTOR_ID_OFFSET + ci;
        tileActorIndexByCell[ci] = index;
        tileActorXByIndex[index] = x;
        tileActorYByIndex[index] = y;
        tileActorKindByIndex[index] = ActorKind.Barrier;
        tileActorIdByIndex[index] = id;
        tileActorDurabilityByIndex[index] = 0;
        tileActorKindByCell[ci] = ActorKind.Barrier;
        tileActorIdByCell[ci] = id;
        index++;
      }
    }
    tileActorCount = index;
  }

  // ── Static hazard helpers ──

  function hasStaticHazardAtIndex(index: number): boolean {
    return staticHazardAffinityByCell[index] !== STATIC_HAZARD_NONE;
  }

  function clearStaticHazardAtIndex(index: number): void {
    if (hasStaticHazardAtIndex(index) && staticHazardCount > 0) {
      staticHazardCount--;
    }
    staticHazardAffinityByCell[index] = STATIC_HAZARD_NONE;
    staticHazardExpressionByCell[index] = 0;
    staticHazardStacksByCell[index] = 0;
    staticHazardManaReserveByCell[index] = 0;
    staticHazardManaMaxByCell[index] = 0;
    staticHazardManaRegenByCell[index] = 0;
    staticHazardDurabilityCurrentByCell[index] = 0;
    staticHazardDurabilityMaxByCell[index] = 0;
    staticHazardDurabilityRegenByCell[index] = 0;
  }

  function clearStaticHazards(): void {
    staticHazardCount = 0;
    staticHazardAffinityByCell.fill(STATIC_HAZARD_NONE);
    staticHazardExpressionByCell.fill(0);
    staticHazardStacksByCell.fill(0);
    staticHazardManaReserveByCell.fill(0);
    staticHazardManaMaxByCell.fill(0);
    staticHazardManaRegenByCell.fill(0);
    staticHazardDurabilityCurrentByCell.fill(0);
    staticHazardDurabilityMaxByCell.fill(0);
    staticHazardDurabilityRegenByCell.fill(0);
  }

  // ── Resource helpers ──

  function clearResources(): void {
    resourceCount = 0;
    resourceVitalKindByCell.fill(RESOURCE_VITAL_NONE);
    resourceDeltaByCell.fill(0);
    resourceModeByCell.fill(0);
  }

  // ── Motivated occupancy ──

  function clearMotivatedOccupancy(): void {
    motivatedOccupancyByCell.fill(0);
  }

  function setMotivatedOccupancyAt(x: number, y: number, value: number): void {
    if (!withinBounds(x, y)) return;
    motivatedOccupancyByCell[indexFor(x, y)] = value;
  }

  function seedMotivatedOccupancyFromActor(): void {
    clearMotivatedOccupancy();
    if (motivatedActorCount > 0) {
      for (let i = 0; i < motivatedActorCount; i++) {
        const mx = motivatedActorXArr[i];
        const my = motivatedActorYArr[i];
        setMotivatedOccupancyAt(mx, my, i + 1);
      }
      return;
    }
    if (actorActive) {
      setMotivatedOccupancyAt(actorX, actorY, 1);
    }
  }

  // ── Placement helpers ──

  function resetActorPlacementsState(): void {
    placementActorCount = 0;
    placementActorOverflow = false;
    clearMotivatedOccupancy();
  }

  // ── Vitals ──

  function fillVitals(target: Int32Array, value: number): void {
    for (let i = 0; i < VITAL_COUNT; i++) target[i] = value;
  }

  function isValidVitalKind(kind: number): boolean {
    return kind >= 0 && kind < VITAL_COUNT;
  }

  function isValidMotivatedActorIndex(index: number): boolean {
    return index >= 0 && index < motivatedActorCount;
  }

  function normalizedActiveMotivatedActorIndex(): number {
    return isValidMotivatedActorIndex(activeMotivatedActorIndex)
      ? activeMotivatedActorIndex
      : 0;
  }

  function resetActorVitals(): void {
    actorVitalMask = 0;
    fillVitals(actorVitalCurrent, 0);
    fillVitals(actorVitalMax, 0);
    fillVitals(actorVitalRegen, 0);
    if (maxMotivatedActors > 0) {
      for (let i = 0; i < VITAL_COUNT; i++) {
        const idx = vitalIndexFor(0, i);
        motivatedActorVitalCurrent[idx] = 0;
        motivatedActorVitalMax[idx] = 0;
        motivatedActorVitalRegen[idx] = 0;
      }
    }
  }

  function resetActorCapabilities(): void {
    actorMovementCost = DEFAULT_MOVEMENT_COST;
    actorActionCostMana = DEFAULT_ACTION_COST_MANA;
    actorActionCostStamina = DEFAULT_ACTION_COST_STAMINA;
    if (maxMotivatedActors > 0) {
      motivatedActorMovementCostArr[0] = actorMovementCost;
      motivatedActorActionCostManaArr[0] = actorActionCostMana;
      motivatedActorActionCostStaminaArr[0] = actorActionCostStamina;
    }
  }

  function applyDefaultCapabilitiesToMotivatedActors(count: number): void {
    actorMovementCost = DEFAULT_MOVEMENT_COST;
    actorActionCostMana = DEFAULT_ACTION_COST_MANA;
    actorActionCostStamina = DEFAULT_ACTION_COST_STAMINA;
    if (count <= 0) {
      resetActorCapabilities();
      return;
    }
    for (let i = 0; i < count; i++) {
      motivatedActorMovementCostArr[i] = DEFAULT_MOVEMENT_COST;
      motivatedActorActionCostManaArr[i] = DEFAULT_ACTION_COST_MANA;
      motivatedActorActionCostStaminaArr[i] = DEFAULT_ACTION_COST_STAMINA;
    }
  }

  function clearActorAffinities(): void {
    motivatedActorAffinityKindArr.fill(0);
    motivatedActorAffinityExpressionArr.fill(0);
    motivatedActorAffinityStacksArr.fill(0);
  }

  function resetMotivatedActors(): void {
    motivatedActorCount = 0;
    activeMotivatedActorIndex = 0;
    actorActive = false;
    actorId = 1;
    actorKind = ActorKind.Motivated;
    actorX = -1;
    actorY = -1;
    resetActorVitals();
    resetActorCapabilities();
    clearActorAffinities();
  }

  function syncActorMirrorFromMotivatedIndex(index: number): void {
    if (!isValidMotivatedActorIndex(index)) return;
    activeMotivatedActorIndex = index;
    actorId = motivatedActorIdArr[index];
    actorX = motivatedActorXArr[index];
    actorY = motivatedActorYArr[index];
    actorVitalMask = VITAL_MASK_ALL;
    for (let kind = 0; kind < VITAL_COUNT; kind++) {
      const offset = vitalIndexFor(index, kind);
      actorVitalCurrent[kind] = motivatedActorVitalCurrent[offset];
      actorVitalMax[kind] = motivatedActorVitalMax[offset];
      actorVitalRegen[kind] = motivatedActorVitalRegen[offset];
    }
    actorMovementCost = motivatedActorMovementCostArr[index];
    actorActionCostMana = motivatedActorActionCostManaArr[index];
    actorActionCostStamina = motivatedActorActionCostStaminaArr[index];
  }

  function findMotivatedActorIndexById(id: number): number {
    if (id <= 0) return -1;
    for (let i = 0; i < motivatedActorCount; i++) {
      if (motivatedActorIdArr[i] === id) return i;
    }
    return -1;
  }

  // ── Affinity field helpers ──

  function fieldIndexFor(x: number, y: number, kind: number): number {
    return (kind - 1) * cellCount + y * width + x;
  }

  function isValidFieldArgs(x: number, y: number, kind: number): boolean {
    return withinBounds(x, y) && isValidAffinityKind(kind);
  }

  function clearAffinityFieldArrays(): void {
    affinityFieldIntensity.fill(0);
    affinityFieldStacks.fill(0);
    affinityFieldExpression.fill(0);
    affinityFieldContribCount.fill(0);
  }

  function projectAffinitySource(
    srcX: number,
    srcY: number,
    kind: number,
    expression: number,
    stacks: number,
  ): void {
    const radius = computeAffinityRadius(expression, stacks);
    const minY = Math.max(srcY - radius, 0);
    const maxY = Math.min(srcY + radius, height - 1);

    for (let cy = minY; cy <= maxY; cy++) {
      const dyAbs = Math.abs(cy - srcY);
      const xRange = radius - dyAbs;
      const minX = Math.max(srcX - xRange, 0);
      const maxX = Math.min(srcX + xRange, width - 1);

      for (let cx = minX; cx <= maxX; cx++) {
        const dxAbs = Math.abs(cx - srcX);
        const dist = dxAbs + dyAbs;

        const intensity =
          dist === 0 ? 1.0 : computeAffinityIntensity(dist, stacks, expression);

        if (intensity <= 0) continue;

        const fi = fieldIndexFor(cx, cy, kind);
        const currentIntensity = affinityFieldIntensity[fi];
        const currentCount = affinityFieldContribCount[fi];

        if (currentCount === 0 || intensity > currentIntensity) {
          affinityFieldIntensity[fi] = intensity;
          affinityFieldStacks[fi] = stacks;
          affinityFieldExpression[fi] = expression;
        }

        affinityFieldContribCount[fi] = currentCount + 1;
      }
    }
  }

  function applyOppositeAffinityFieldCancellation(): number {
    let canceledCells = 0;
    for (let ci = 0; ci < cellCount; ci++) {
      const x = ci % width;
      const y = Math.trunc(ci / width);
      for (let kind = 1; kind <= AFFINITY_KIND_COUNT; kind++) {
        const opposite = getOppositeAffinityKind(kind);
        if (opposite <= kind) continue;

        const sourceIndex = fieldIndexFor(x, y, kind);
        const targetIndex = fieldIndexFor(x, y, opposite);
        const sourceStacks = affinityFieldStacks[sourceIndex];
        const targetStacks = affinityFieldStacks[targetIndex];
        const sourceIntensity = affinityFieldIntensity[sourceIndex];
        const targetIntensity = affinityFieldIntensity[targetIndex];
        if (sourceStacks <= 0 || targetStacks <= 0) continue;
        if (sourceIntensity <= 0 || targetIntensity <= 0) continue;
        if (
          affinityFieldContribCount[sourceIndex] <= 0 ||
          affinityFieldContribCount[targetIndex] <= 0
        ) {
          continue;
        }

        // Projected intensity already encodes distance falloff. Cancel it at
        // the overlap point rather than canceling whole source stacks, so a
        // nearby opposite field cannot erase a hazard at its own origin.
        const netSourceIntensity = Math.max(0, sourceIntensity - targetIntensity);
        const netTargetIntensity = Math.max(0, targetIntensity - sourceIntensity);
        const sourceCanceled = netSourceIntensity === 0;
        const targetCanceled = netTargetIntensity === 0;

        affinityFieldIntensity[sourceIndex] = netSourceIntensity;
        affinityFieldIntensity[targetIndex] = netTargetIntensity;
        if (sourceCanceled) {
          affinityFieldStacks[sourceIndex] = 0;
          affinityFieldExpression[sourceIndex] = 0;
        } else if (targetCanceled) {
          affinityFieldStacks[sourceIndex] =
            sourceStacks > targetStacks ? sourceStacks - targetStacks : sourceStacks;
        }
        if (targetCanceled) {
          affinityFieldStacks[targetIndex] = 0;
          affinityFieldExpression[targetIndex] = 0;
        } else if (sourceCanceled) {
          affinityFieldStacks[targetIndex] =
            targetStacks > sourceStacks ? targetStacks - sourceStacks : targetStacks;
        }
        canceledCells++;
      }
    }
    return canceledCells;
  }

  // ── Tile placement (private) ──

  function setTile(x: number, y: number, tile: number): void {
    if (!withinBounds(x, y)) return;
    const idx = indexFor(x, y);
    tiles[idx] = tile;
    if (tile !== Tile.Floor) clearStaticHazardAtIndex(idx);
    setTileActorKindAtIndex(idx, actorKindForTile(tile));
    setTileDurabilityAtIndex(idx, durabilityForTile(tile));
    if (tile === Tile.Spawn) {
      spawnX = x;
      spawnY = y;
    } else if (tile === Tile.Exit) {
      exitX = x;
      exitY = y;
    }
  }

  function setRowFromString(y: number, row: string): void {
    for (let x = 0; x < row.length && x < width; x++) {
      const code = row.charCodeAt(x);
      if (code === 35) setTile(x, y, Tile.Wall);       // '#'
      else if (code === 46) setTile(x, y, Tile.Floor);  // '.'
      else if (code === 83) setTile(x, y, Tile.Spawn);  // 'S'
      else if (code === 69) setTile(x, y, Tile.Exit);   // 'E'
      else if (code === 66) setTile(x, y, Tile.Barrier); // 'B'
    }
  }

  // ── World reset ──

  function resetWorldState(): void {
    spawnX = -1;
    spawnY = -1;
    exitX = -1;
    exitY = -1;
    resetMotivatedActors();
    currentTick = 0;
    fillTiles(Tile.Wall);
    clearTileActorState();
    clearStaticHazards();
    clearResources();
    clearAffinityFieldArrays();
    resetActorPlacementsState();
  }

  // ── Tick regen ──

  function clampVitalValue(current: number, max: number, regen: number): number {
    const next = current + regen;
    return next > max ? max : next;
  }

  function applyRegenForActorIndex(index: number): void {
    for (let kind = 0; kind < VITAL_COUNT; kind++) {
      if (kind === VitalKind.Durability) continue;
      const offset = vitalIndexFor(index, kind);
      const current = motivatedActorVitalCurrent[offset];
      const max = motivatedActorVitalMax[offset];
      const regen = motivatedActorVitalRegen[offset];
      const next = clampVitalValue(current, max, regen);
      motivatedActorVitalCurrent[offset] = next;
      if (index === normalizedActiveMotivatedActorIndex()) {
        actorVitalCurrent[kind] = next;
      }
    }
  }

  function applyTickRegen(): void {
    if (motivatedActorCount > 0) {
      for (let i = 0; i < motivatedActorCount; i++) {
        applyRegenForActorIndex(i);
      }
    } else if (actorActive) {
      for (let kind = 0; kind < VITAL_COUNT; kind++) {
        if (kind === VitalKind.Durability) continue;
        actorVitalCurrent[kind] = clampVitalValue(
          actorVitalCurrent[kind],
          actorVitalMax[kind],
          actorVitalRegen[kind],
        );
      }
    }
    // Per-hazard mana and durability regen (independent of actor regen)
    if (staticHazardCount > 0) {
      const cellCount = width * height;
      for (let idx = 0; idx < cellCount; idx++) {
        if (staticHazardAffinityByCell[idx] === STATIC_HAZARD_NONE) continue;
        const manaRegen = staticHazardManaRegenByCell[idx];
        if (manaRegen > 0) {
          const manaMax = staticHazardManaMaxByCell[idx];
          const manaCur = staticHazardManaReserveByCell[idx];
          if (manaCur < manaMax) {
            staticHazardManaReserveByCell[idx] = Math.min(manaMax, manaCur + manaRegen);
          }
        }
        const durRegen = staticHazardDurabilityRegenByCell[idx];
        if (durRegen > 0) {
          const durMax = staticHazardDurabilityMaxByCell[idx];
          const durCur = staticHazardDurabilityCurrentByCell[idx];
          if (durCur < durMax) {
            staticHazardDurabilityCurrentByCell[idx] = Math.min(durMax, durCur + durRegen);
          }
        }
      }
    }
  }

  // ── Placement helpers (private) ──

  function getPlacementCount(): number {
    if (placementActorCount > 0) return placementActorCount;
    return actorActive ? 1 : 0;
  }

  function getPlacementId(index: number): number {
    return placementActorCount > 0 ? placementActorId[index] : actorId;
  }

  function getPlacementX(index: number): number {
    return placementActorCount > 0 ? placementActorX[index] : actorX;
  }

  function getPlacementY(index: number): number {
    return placementActorCount > 0 ? placementActorY[index] : actorY;
  }

  function getTileActorKindAt(x: number, y: number): number {
    if (!withinBounds(x, y)) return ActorKind.Barrier;
    return tileActorKindByCell[indexFor(x, y)];
  }

  function getTileLocal(x: number, y: number): number {
    if (!withinBounds(x, y)) return Tile.Wall;
    return tiles[indexFor(x, y)];
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
      initTileActorsForBounds();
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

    spawnActorAt(x: number, y: number): void {
      if (!withinBounds(x, y)) return;
      motivatedActorCount = 1;
      activeMotivatedActorIndex = 0;
      if (actorId <= 0) actorId = 1;
      motivatedActorIdArr[0] = actorId;
      motivatedActorXArr[0] = x;
      motivatedActorYArr[0] = y;
      actorActive = true;
      actorX = x;
      actorY = y;
      applyDefaultCapabilitiesToMotivatedActors(1);
      seedMotivatedOccupancyFromActor();
    },

    // ── MVP scenarios ──

    loadMvpScenario(): void {
      this.configureGrid(9, 9);
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
      this.setActorVital(VitalKind.Health, 10, 10, 0);
      this.setActorVital(VitalKind.Mana, 0, 0, 0);
      this.setActorVital(VitalKind.Stamina, 12, 12, 0);
      this.setActorVital(VitalKind.Durability, 0, 0, 0);
      if (spawnX >= 0 && spawnY >= 0) {
        this.spawnActorAt(spawnX, spawnY);
      }
      currentTick = 0;
    },

    loadMvpBarrierScenario(): void {
      this.configureGrid(9, 9);
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
      this.setActorVital(VitalKind.Health, 10, 10, 0);
      this.setActorVital(VitalKind.Mana, 0, 0, 0);
      this.setActorVital(VitalKind.Stamina, 12, 12, 0);
      this.setActorVital(VitalKind.Durability, 0, 0, 0);
      if (spawnX >= 0 && spawnY >= 0) {
        this.spawnActorAt(spawnX, spawnY);
      }
      currentTick = 0;
    },

    // ── Bounds and queries ──

    withinBounds,

    isWalkablePosition(x: number, y: number): boolean {
      return isWalkableActorKindLocal(getTileActorKindAt(x, y));
    },

    isMotivatedOccupied(x: number, y: number): boolean {
      if (!withinBounds(x, y)) return true;
      return motivatedOccupancyByCell[indexFor(x, y)] !== 0;
    },

    isActorAtExit(): boolean {
      if (!actorActive) return false;
      return actorX === exitX && actorY === exitY;
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

    renderCellChar(x: number, y: number): number {
      if (actorActive && x === actorX && y === actorY) return 64; // '@'
      return this.renderBaseCellChar(x, y);
    },

    // ── Actor state ──

    hasActor(): boolean {
      return actorActive || motivatedActorCount > 0;
    },

    getActorId: () => actorId,
    getActorKind: () => actorKind,
    getActorX: () => actorX,
    getActorY: () => actorY,
    getActorHp: () => actorVitalCurrent[VitalKind.Health],
    getActorMaxHp: () => actorVitalMax[VitalKind.Health],
    getActorMovementCost: () => actorMovementCost,
    getActorActionCostMana: () => actorActionCostMana,
    getActorActionCostStamina: () => actorActionCostStamina,

    getActorVitalCurrent(kind: number): number {
      return isValidVitalKind(kind) ? actorVitalCurrent[kind] : 0;
    },

    getActorVitalMax(kind: number): number {
      return isValidVitalKind(kind) ? actorVitalMax[kind] : 0;
    },

    getActorVitalRegen(kind: number): number {
      return isValidVitalKind(kind) ? actorVitalRegen[kind] : 0;
    },

    setActorVital(kind: number, current: number, max: number, regen: number): void {
      if (!isValidVitalKind(kind)) return;
      actorVitalCurrent[kind] = current;
      actorVitalMax[kind] = max;
      actorVitalRegen[kind] = regen;
      if (motivatedActorCount > 0) {
        const ai = normalizedActiveMotivatedActorIndex();
        const offset = vitalIndexFor(ai, kind);
        motivatedActorVitalCurrent[offset] = current;
        motivatedActorVitalMax[offset] = max;
        motivatedActorVitalRegen[offset] = regen;
      }
      actorVitalMask |= 1 << kind;
    },

    setActorMovementCost(value: number): void {
      actorMovementCost = value;
      if (motivatedActorCount > 0) {
        motivatedActorMovementCostArr[normalizedActiveMotivatedActorIndex()] = value;
      }
    },

    setActorActionCostMana(value: number): void {
      actorActionCostMana = value;
      if (motivatedActorCount > 0) {
        motivatedActorActionCostManaArr[normalizedActiveMotivatedActorIndex()] = value;
      }
    },

    setActorActionCostStamina(value: number): void {
      actorActionCostStamina = value;
      if (motivatedActorCount > 0) {
        motivatedActorActionCostStaminaArr[normalizedActiveMotivatedActorIndex()] = value;
      }
    },

    setActorPosition(x: number, y: number): void {
      if (!withinBounds(x, y)) return;
      const ai = normalizedActiveMotivatedActorIndex();
      const occupancyId = ai + 1;
      if (actorActive) setMotivatedOccupancyAt(actorX, actorY, 0);
      actorX = x;
      actorY = y;
      if (isValidMotivatedActorIndex(ai)) {
        motivatedActorXArr[ai] = x;
        motivatedActorYArr[ai] = y;
      }
      if (actorActive) setMotivatedOccupancyAt(actorX, actorY, occupancyId);
    },

    // ── Motivated actor vitals ──

    setMotivatedActorVital(
      index: number,
      kind: number,
      current: number,
      max: number,
      regen: number,
    ): void {
      if (!isValidVitalKind(kind) || index < 0 || index >= motivatedActorCount)
        return;
      const offset = vitalIndexFor(index, kind);
      motivatedActorVitalCurrent[offset] = current;
      motivatedActorVitalMax[offset] = max;
      motivatedActorVitalRegen[offset] = regen;
      if (index === normalizedActiveMotivatedActorIndex()) {
        actorVitalCurrent[kind] = current;
        actorVitalMax[kind] = max;
        actorVitalRegen[kind] = regen;
        actorVitalMask |= 1 << kind;
      }
    },

    // ── Motivated actor capabilities ──

    setMotivatedActorMovementCost(index: number, value: number): void {
      if (!isValidMotivatedActorIndex(index)) return;
      motivatedActorMovementCostArr[index] = value;
      if (index === normalizedActiveMotivatedActorIndex()) actorMovementCost = value;
    },

    setMotivatedActorActionCostMana(index: number, value: number): void {
      if (!isValidMotivatedActorIndex(index)) return;
      motivatedActorActionCostManaArr[index] = value;
      if (index === normalizedActiveMotivatedActorIndex()) actorActionCostMana = value;
    },

    setMotivatedActorActionCostStamina(index: number, value: number): void {
      if (!isValidMotivatedActorIndex(index)) return;
      motivatedActorActionCostStaminaArr[index] = value;
      if (index === normalizedActiveMotivatedActorIndex()) actorActionCostStamina = value;
    },

    // ── Validation ──

    validateActorVitals(): number {
      if ((actorVitalMask & VITAL_MASK_ALL) !== VITAL_MASK_ALL)
        return ValidationError.MissingVital;
      for (let i = 0; i < VITAL_COUNT; i++) {
        const c = actorVitalCurrent[i];
        const m = actorVitalMax[i];
        const r = actorVitalRegen[i];
        if (c < 0 || m < 0 || r < 0 || c > m) return ValidationError.InvalidVital;
      }
      return ValidationError.None;
    },

    validateActorCapabilities(): number {
      if (actorMovementCost < 0 || actorActionCostMana < 0 || actorActionCostStamina < 0)
        return ValidationError.InvalidCapability;
      for (let i = 0; i < motivatedActorCount; i++) {
        if (
          motivatedActorMovementCostArr[i] < 0 ||
          motivatedActorActionCostManaArr[i] < 0 ||
          motivatedActorActionCostStaminaArr[i] < 0
        )
          return ValidationError.InvalidCapability;
      }
      return ValidationError.None;
    },

    // ── Actor placements ──

    clearActorPlacements(): void {
      resetActorPlacementsState();
    },

    addActorPlacement(id: number, x: number, y: number): void {
      if (placementActorCount >= maxMotivatedActors) {
        placementActorOverflow = true;
        return;
      }
      placementActorId[placementActorCount] = id;
      placementActorX[placementActorCount] = x;
      placementActorY[placementActorCount] = y;
      placementActorCount++;
    },

    getActorPlacementCount: () => placementActorCount,

    // allowReservedTiles: run-seeding mode — an initial state may legitimately
    // seat an actor on the spawn (or exit) tile at tick 0. Authoring-time
    // placement keeps the strict default, which reserves those tiles.
    validateActorPlacement(allowReservedTiles: boolean = false): number {
      const count = getPlacementCount();
      if (count <= 0) return ValidationError.None;
      if (placementActorOverflow || count > maxMotivatedActors)
        return ValidationError.TooManyActors;
      for (let i = 0; i < count; i++) {
        if (!withinBounds(getPlacementX(i), getPlacementY(i)))
          return ValidationError.ActorOutOfBounds;
      }
      // validate occupancy
      clearMotivatedOccupancy();
      for (let i = 0; i < count; i++) {
        const px = getPlacementX(i);
        const py = getPlacementY(i);
        if (
          !allowReservedTiles &&
          ((spawnX >= 0 && spawnY >= 0 && px === spawnX && py === spawnY) ||
            (exitX >= 0 && exitY >= 0 && px === exitX && py === exitY))
        )
          return ValidationError.ActorBlocked;
        if (!isWalkableActorKindLocal(getTileActorKindAt(px, py)))
          return ValidationError.ActorBlocked;
        const ci = indexFor(px, py);
        if (motivatedOccupancyByCell[ci] !== 0)
          return ValidationError.ActorCollision;
        motivatedOccupancyByCell[ci] = i + 1;
      }
      return ValidationError.None;
    },

    applyActorPlacements(allowReservedTiles: boolean = false): number {
      const count = getPlacementCount();
      if (count <= 0) return ValidationError.None;
      if (placementActorOverflow || count > maxMotivatedActors)
        return ValidationError.TooManyActors;
      const error = this.validateActorPlacement(allowReservedTiles);
      if (error !== ValidationError.None) return error;
      motivatedActorCount = count;
      activeMotivatedActorIndex = 0;
      for (let i = 0; i < count; i++) {
        let id = getPlacementId(i);
        if (id <= 0) id = i + 1;
        motivatedActorIdArr[i] = id;
        motivatedActorXArr[i] = getPlacementX(i);
        motivatedActorYArr[i] = getPlacementY(i);
      }
      actorActive = count > 0;
      if (actorActive) syncActorMirrorFromMotivatedIndex(0);
      resetActorVitals();
      applyDefaultCapabilitiesToMotivatedActors(count);
      return ValidationError.None;
    },

    // ── Motivated actor queries ──

    getMotivatedActorCount: () => motivatedActorCount,

    getMotivatedActorIdByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorIdArr[index] : 0;
    },

    getMotivatedActorXByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorXArr[index] : -1;
    },

    getMotivatedActorYByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorYArr[index] : -1;
    },

    getMotivatedActorVitalCurrentByIndex(index: number, kind: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidVitalKind(kind)) return 0;
      return motivatedActorVitalCurrent[vitalIndexFor(index, kind)];
    },

    getMotivatedActorVitalMaxByIndex(index: number, kind: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidVitalKind(kind)) return 0;
      return motivatedActorVitalMax[vitalIndexFor(index, kind)];
    },

    getMotivatedActorVitalRegenByIndex(index: number, kind: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidVitalKind(kind)) return 0;
      return motivatedActorVitalRegen[vitalIndexFor(index, kind)];
    },

    getMotivatedActorMovementCostByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorMovementCostArr[index] : 0;
    },

    getMotivatedActorActionCostManaByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorActionCostManaArr[index] : 0;
    },

    getMotivatedActorActionCostStaminaByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorActionCostStaminaArr[index] : 0;
    },

    // ── Active motivated actor ──

    setActiveMotivatedActor(id: number): number {
      if (motivatedActorCount <= 0) return ValidationError.WrongActor;
      const index = findMotivatedActorIndexById(id);
      if (index < 0) return ValidationError.WrongActor;
      syncActorMirrorFromMotivatedIndex(index);
      return ValidationError.None;
    },

    // ── Tick ──

    advanceTick(): void {
      applyTickRegen();
      currentTick++;
    },

    getCurrentTick: () => currentTick,

    // ── Tile actor queries ──

    getTileActorCount: () => tileActorCount,

    getTileActorIndex(x: number, y: number): number {
      if (!withinBounds(x, y)) return INVALID_TILE_ACTOR_INDEX;
      return tileActorIndexByCell[indexFor(x, y)];
    },

    getTileActorId(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return tileActorIdByCell[indexFor(x, y)];
    },

    getTileActorKind(x: number, y: number): number {
      return getTileActorKindAt(x, y);
    },

    getTileActorXByIndex(index: number): number {
      return index >= 0 && index < tileActorCount ? tileActorXByIndex[index] : -1;
    },

    getTileActorYByIndex(index: number): number {
      return index >= 0 && index < tileActorCount ? tileActorYByIndex[index] : -1;
    },

    getTileActorKindByIndex(index: number): number {
      return index >= 0 && index < tileActorCount ? tileActorKindByIndex[index] : ActorKind.Barrier;
    },

    getTileActorIdByIndex(index: number): number {
      return index >= 0 && index < tileActorCount ? tileActorIdByIndex[index] : 0;
    },

    getTileActorDurabilityByIndex(index: number): number {
      return index >= 0 && index < tileActorCount ? tileActorDurabilityByIndex[index] : 0;
    },

    getTileActorDurability(x: number, y: number): number {
      const idx = this.getTileActorIndex(x, y);
      if (idx === INVALID_TILE_ACTOR_INDEX) return 0;
      return tileActorDurabilityByIndex[idx];
    },

    // ── Barriers ──

    raiseBarrierAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      if (getTileLocal(x, y) !== Tile.Floor) return 0;
      setTile(x, y, Tile.Barrier);
      return 1;
    },

    destroyBarrierAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      if (getTileLocal(x, y) !== Tile.Barrier) return 0;
      setTile(x, y, Tile.Floor);
      return 1;
    },

    // ── Static hazards ──

    armStaticHazardAt(
      x: number,
      y: number,
      affinityKind: number,
      expression: number,
      stacks: number,
      manaReserve: number,
      durabilityCurrentOpt = 0,
      durabilityMaxOpt = 0,
      durabilityRegenOpt = 0,
      manaMaxOpt = -1,   // -1 sentinel → default to manaReserve
      manaRegenOpt = 0,
    ): number {
      if (!withinBounds(x, y)) return 0;
      if (affinityKind <= 0 || expression <= 0) return 0;
      if (stacks <= 0 || manaReserve < 0) return 0;
      if (getTileLocal(x, y) !== Tile.Floor) return 0;
      const idx = indexFor(x, y);
      if (!hasStaticHazardAtIndex(idx)) staticHazardCount++;
      staticHazardAffinityByCell[idx] = affinityKind;
      staticHazardExpressionByCell[idx] = expression;
      staticHazardStacksByCell[idx] = stacks;
      const manaMax = manaMaxOpt < 0 ? manaReserve : Math.max(0, manaMaxOpt);
      staticHazardManaReserveByCell[idx] = Math.min(Math.max(0, manaReserve), manaMax);
      staticHazardManaMaxByCell[idx] = manaMax;
      staticHazardManaRegenByCell[idx] = Math.max(0, manaRegenOpt);
      staticHazardDurabilityCurrentByCell[idx] = Math.max(0, durabilityCurrentOpt);
      staticHazardDurabilityMaxByCell[idx] = Math.max(0, durabilityMaxOpt);
      staticHazardDurabilityRegenByCell[idx] = Math.max(0, durabilityRegenOpt);
      return 1;
    },

    disarmStaticHazardAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      const idx = indexFor(x, y);
      if (!hasStaticHazardAtIndex(idx)) return 0;
      clearStaticHazardAtIndex(idx);
      return 1;
    },

    getStaticHazardCount: () => staticHazardCount,

    getStaticHazardAffinityAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return STATIC_HAZARD_NONE;
      return staticHazardAffinityByCell[indexFor(x, y)];
    },

    getStaticHazardExpressionAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardExpressionByCell[indexFor(x, y)];
    },

    getStaticHazardStacksAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardStacksByCell[indexFor(x, y)];
    },

    getStaticHazardManaReserveAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardManaReserveByCell[indexFor(x, y)];
    },

    getStaticHazardManaMaxAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardManaMaxByCell[indexFor(x, y)];
    },

    getStaticHazardManaRegenAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardManaRegenByCell[indexFor(x, y)];
    },

    setStaticHazardManaCurrentAt(x: number, y: number, current: number): number {
      if (!withinBounds(x, y)) return 0;
      const idx = indexFor(x, y);
      if (!hasStaticHazardAtIndex(idx)) return 0;
      staticHazardManaReserveByCell[idx] = Math.max(0, current);
      return 1;
    },

    getStaticHazardDurabilityAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardDurabilityCurrentByCell[indexFor(x, y)];
    },

    getStaticHazardDurabilityMaxAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardDurabilityMaxByCell[indexFor(x, y)];
    },

    getStaticHazardDurabilityRegenAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return staticHazardDurabilityRegenByCell[indexFor(x, y)];
    },

    setStaticHazardDurabilityCurrentAt(x: number, y: number, current: number): number {
      if (!withinBounds(x, y)) return 0;
      const idx = indexFor(x, y);
      if (!hasStaticHazardAtIndex(idx)) return 0;
      staticHazardDurabilityCurrentByCell[idx] = Math.max(0, current);
      return 1;
    },

    // ── Resources ──

    hasResourceAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceVitalKindByCell[indexFor(x, y)] !== RESOURCE_VITAL_NONE ? 1 : 0;
    },

    getResourceVitalKindAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return RESOURCE_VITAL_NONE;
      return resourceVitalKindByCell[indexFor(x, y)];
    },

    getResourceDeltaAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceDeltaByCell[indexFor(x, y)];
    },

    getResourceModeAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceModeByCell[indexFor(x, y)];
    },

    removeResourceAt(x: number, y: number): void {
      if (!withinBounds(x, y)) return;
      const idx = indexFor(x, y);
      if (resourceVitalKindByCell[idx] === RESOURCE_VITAL_NONE) return;
      resourceVitalKindByCell[idx] = RESOURCE_VITAL_NONE;
      resourceDeltaByCell[idx] = 0;
      resourceModeByCell[idx] = 0;
      if (resourceCount > 0) resourceCount--;
    },

    // ── Affinity field ──

    clearAffinityField(): number {
      clearAffinityFieldArrays();
      return 1;
    },

    getAffinityFieldIntensityAt(x: number, y: number, kind: number): number {
      if (!isValidFieldArgs(x, y, kind)) return 0;
      return affinityFieldIntensity[fieldIndexFor(x, y, kind)];
    },

    getAffinityFieldStacksAt(x: number, y: number, kind: number): number {
      if (!isValidFieldArgs(x, y, kind)) return 0;
      return affinityFieldStacks[fieldIndexFor(x, y, kind)];
    },

    getAffinityFieldExpressionAt(x: number, y: number, kind: number): number {
      if (!isValidFieldArgs(x, y, kind)) return 0;
      return affinityFieldExpression[fieldIndexFor(x, y, kind)];
    },

    getAffinityFieldContributionCountAt(x: number, y: number, kind: number): number {
      if (!isValidFieldArgs(x, y, kind)) return 0;
      return affinityFieldContribCount[fieldIndexFor(x, y, kind)];
    },

    computeStaticHazardAffinityField(): number {
      clearAffinityFieldArrays();
      let count = 0;
      for (let ci = 0; ci < cellCount; ci++) {
        const kind = staticHazardAffinityByCell[ci];
        if (kind === STATIC_HAZARD_NONE) continue;
        if (staticHazardManaReserveByCell[ci] <= 0) continue;
        const expression = staticHazardExpressionByCell[ci];
        const stacks = staticHazardStacksByCell[ci];
        if (!isValidAffinityExpression(expression) || stacks <= 0) continue;
        const hazardX = ci % width;
        const hazardY = Math.trunc(ci / width);
        projectAffinitySource(hazardX, hazardY, kind, expression, stacks);
        count++;
      }
      applyOppositeAffinityFieldCancellation();
      return count;
    },

    computeActorAffinityField(): number {
      let count = 0;
      for (let i = 0; i < motivatedActorCount; i++) {
        const kind = motivatedActorAffinityKindArr[i];
        if (kind === 0) continue;
        const expression = motivatedActorAffinityExpressionArr[i];
        const stacks = motivatedActorAffinityStacksArr[i];
        if (!isValidAffinityExpression(expression) || stacks <= 0) continue;
        projectAffinitySource(
          motivatedActorXArr[i],
          motivatedActorYArr[i],
          kind,
          expression,
          stacks,
        );
        count++;
      }
      applyOppositeAffinityFieldCancellation();
      return count;
    },

    computeAffinityField(): number {
      clearAffinityFieldArrays();
      let totalSources = 0;
      for (let ci = 0; ci < cellCount; ci++) {
        const kind = staticHazardAffinityByCell[ci];
        if (kind === STATIC_HAZARD_NONE) continue;
        if (staticHazardManaReserveByCell[ci] <= 0) continue;
        const expression = staticHazardExpressionByCell[ci];
        const stacks = staticHazardStacksByCell[ci];
        if (!isValidAffinityExpression(expression) || stacks <= 0) continue;
        const hazardX = ci % width;
        const hazardY = Math.trunc(ci / width);
        projectAffinitySource(hazardX, hazardY, kind, expression, stacks);
        totalSources++;
      }
      totalSources += this.computeActorAffinityField();
      return totalSources;
    },

    // ── Motivated actor affinity ──

    setMotivatedActorAffinity(
      index: number,
      kind: number,
      expression: number,
      stacks: number,
    ): number {
      if (!isValidMotivatedActorIndex(index)) return 0;
      if (!isValidAffinityKind(kind)) return 0;
      if (!isValidAffinityExpression(expression)) return 0;
      if (stacks <= 0) return 0;
      motivatedActorAffinityKindArr[index] = kind;
      motivatedActorAffinityExpressionArr[index] = expression;
      motivatedActorAffinityStacksArr[index] = stacks;
      return 1;
    },

    clearMotivatedActorAffinity(index: number): number {
      if (!isValidMotivatedActorIndex(index)) return 0;
      motivatedActorAffinityKindArr[index] = 0;
      motivatedActorAffinityExpressionArr[index] = 0;
      motivatedActorAffinityStacksArr[index] = 0;
      return 1;
    },

    getMotivatedActorAffinityKindByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorAffinityKindArr[index] : 0;
    },

    getMotivatedActorAffinityExpressionByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorAffinityExpressionArr[index] : 0;
    },

    getMotivatedActorAffinityStacksByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorAffinityStacksArr[index] : 0;
    },
  };
}
