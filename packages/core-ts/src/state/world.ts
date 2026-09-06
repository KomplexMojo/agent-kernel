// World state — grid, tiles, actors, motivated actors, hazards, resources, affinity field.
// Ported from packages/core-ts/src/state/world.ts (1618 lines).
// No IO, no imports outside core-ts.

import { ValidationError } from "../validate/inputs.ts";
import {
  getOppositeAffinityKind,
  isValidAffinityKind,
  isValidAffinityExpression,
  MAX_AFFINITY_GRANTS_PER_ACTOR,
} from "./affinity.ts";
import { computeAffinityRadius, computeAffinityIntensity } from "./affinity-spatial.ts";
import { SIGHT_AFFINITY_KINDS, resolveVisibilityRadius } from "./visibility.ts";
import { VitalKind } from "./vitals.ts";

// ── Tile codes ──

/**
 * Ticks an actor must END on the exit tile before it has left the level.
 *
 * Two, by maintainer ruling (2026-09-05). One would retire an actor that merely passes
 * across the exit on its way somewhere else, which is a different event.
 */
export const EXIT_DWELL_TICKS = 2;

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
  // Vital regen the resource hands over. Independent of resourceModeByCell, which
  // governs the delta only. A granted rate is permanent — actors have no regen pool.
  let resourceVitalRegenByCell = new Int32Array(0);
  // Affinity payload — a resource may carry this instead of, or alongside, a vital
  // payload. manaRegen > 0 is what makes the granted affinity permanent.
  let resourceAffinityKindByCell = new Int32Array(0);
  let resourceAffinityExpressionByCell = new Int32Array(0);
  let resourceAffinityStacksByCell = new Int32Array(0);
  let resourceManaByCell = new Int32Array(0);
  let resourceManaRegenByCell = new Int32Array(0);
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
  // Leaving the level (maintainer ruling, 2026-09-05). Consecutive ticks ENDED on the
  // exit tile, and the resulting flag. Two ticks means the actor has left.
  let motivatedActorExitDwellArr = new Int32Array(0);
  let motivatedActorExitedArr = new Int32Array(0);
  let motivatedActorMovementCostArr = new Int32Array(0);
  let motivatedActorActionCostManaArr = new Int32Array(0);
  let motivatedActorActionCostStaminaArr = new Int32Array(0);
  let motivatedActorAffinityKindArr = new Int32Array(0);
  let motivatedActorAffinityExpressionArr = new Int32Array(0);
  let motivatedActorAffinityStacksArr = new Int32Array(0);
  // Affinity grants — stride layout, MAX_AFFINITY_GRANTS_PER_ACTOR slots per actor.
  // Slot is occupied iff grantKind > 0; occupied slots are kept contiguous from 0.
  let motivatedActorGrantKindArr = new Int32Array(0);
  let motivatedActorGrantExpressionArr = new Int32Array(0);
  let motivatedActorGrantStacksArr = new Int32Array(0);
  let motivatedActorGrantManaArr = new Int32Array(0);
  let motivatedActorGrantManaMaxArr = new Int32Array(0);
  let motivatedActorGrantManaRegenArr = new Int32Array(0);
  let activeMotivatedActorIndex = 0;
  let currentTick = 0;

  // ── Index helpers ──

  function indexFor(x: number, y: number): number {
    return y * width + x;
  }

  function vitalIndexFor(actorIndex: number, kind: number): number {
    return actorIndex * VITAL_COUNT + kind;
  }

  function grantIndexFor(actorIndex: number, slot: number): number {
    return actorIndex * MAX_AFFINITY_GRANTS_PER_ACTOR + slot;
  }

  function isValidGrantSlot(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < MAX_AFFINITY_GRANTS_PER_ACTOR;
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
    resourceVitalRegenByCell = new Int32Array(cellCount);
    resourceAffinityKindByCell = new Int32Array(cellCount);
    resourceAffinityExpressionByCell = new Int32Array(cellCount);
    resourceAffinityStacksByCell = new Int32Array(cellCount);
    resourceManaByCell = new Int32Array(cellCount);
    resourceManaRegenByCell = new Int32Array(cellCount);
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
    motivatedActorExitDwellArr = new Int32Array(maxMotivatedActors);
    motivatedActorExitedArr = new Int32Array(maxMotivatedActors);
    motivatedActorMovementCostArr = new Int32Array(maxMotivatedActors);
    motivatedActorActionCostManaArr = new Int32Array(maxMotivatedActors);
    motivatedActorActionCostStaminaArr = new Int32Array(maxMotivatedActors);
    motivatedActorAffinityKindArr = new Int32Array(maxMotivatedActors);
    motivatedActorAffinityExpressionArr = new Int32Array(maxMotivatedActors);
    motivatedActorAffinityStacksArr = new Int32Array(maxMotivatedActors);

    const grantSize = maxMotivatedActors * MAX_AFFINITY_GRANTS_PER_ACTOR;
    motivatedActorGrantKindArr = new Int32Array(grantSize);
    motivatedActorGrantExpressionArr = new Int32Array(grantSize);
    motivatedActorGrantStacksArr = new Int32Array(grantSize);
    motivatedActorGrantManaArr = new Int32Array(grantSize);
    motivatedActorGrantManaMaxArr = new Int32Array(grantSize);
    motivatedActorGrantManaRegenArr = new Int32Array(grantSize);

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
    resourceVitalRegenByCell.fill(0);
    resourceAffinityKindByCell.fill(0);
    resourceAffinityExpressionByCell.fill(0);
    resourceAffinityStacksByCell.fill(0);
    resourceManaByCell.fill(0);
    resourceManaRegenByCell.fill(0);
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
        // An actor that has left the level occupies nothing. Re-seeding its body here
        // would silently undo the vacate in `applyExitDwell` on the next rebuild.
        if (motivatedActorExitedArr[i] !== 0) continue;
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
    motivatedActorGrantKindArr.fill(0);
    motivatedActorGrantExpressionArr.fill(0);
    motivatedActorGrantStacksArr.fill(0);
    motivatedActorGrantManaArr.fill(0);
    motivatedActorGrantManaMaxArr.fill(0);
    motivatedActorGrantManaRegenArr.fill(0);
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
    motivatedActorExitDwellArr.fill(0);
    motivatedActorExitedArr.fill(0);
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

  // ── Affinity grants ──

  function grantSlotCount(actorIndex: number): number {
    let count = 0;
    for (let slot = 0; slot < MAX_AFFINITY_GRANTS_PER_ACTOR; slot++) {
      if (motivatedActorGrantKindArr[grantIndexFor(actorIndex, slot)] > 0) count++;
    }
    return count;
  }

  /** A grant contributes stacks unless it is a pooled grant sitting at zero mana. */
  function grantContributes(offset: number): boolean {
    if (motivatedActorGrantKindArr[offset] <= 0) return false;
    if (motivatedActorGrantManaMaxArr[offset] === 0) return true; // innate
    return motivatedActorGrantManaArr[offset] > 0;
  }

  /** Removes a grant and shifts later grants down so occupied slots stay contiguous. */
  function removeGrantAt(actorIndex: number, slot: number): void {
    for (let s = slot; s < MAX_AFFINITY_GRANTS_PER_ACTOR - 1; s++) {
      const dst = grantIndexFor(actorIndex, s);
      const src = grantIndexFor(actorIndex, s + 1);
      motivatedActorGrantKindArr[dst] = motivatedActorGrantKindArr[src];
      motivatedActorGrantExpressionArr[dst] = motivatedActorGrantExpressionArr[src];
      motivatedActorGrantStacksArr[dst] = motivatedActorGrantStacksArr[src];
      motivatedActorGrantManaArr[dst] = motivatedActorGrantManaArr[src];
      motivatedActorGrantManaMaxArr[dst] = motivatedActorGrantManaMaxArr[src];
      motivatedActorGrantManaRegenArr[dst] = motivatedActorGrantManaRegenArr[src];
    }
    const last = grantIndexFor(actorIndex, MAX_AFFINITY_GRANTS_PER_ACTOR - 1);
    motivatedActorGrantKindArr[last] = 0;
    motivatedActorGrantExpressionArr[last] = 0;
    motivatedActorGrantStacksArr[last] = 0;
    motivatedActorGrantManaArr[last] = 0;
    motivatedActorGrantManaMaxArr[last] = 0;
    motivatedActorGrantManaRegenArr[last] = 0;
  }

  /** A pooled, non-regenerating grant drained to zero is spent and must be dropped. */
  function isExhaustedGrant(offset: number): boolean {
    return (
      motivatedActorGrantKindArr[offset] > 0 &&
      motivatedActorGrantManaMaxArr[offset] > 0 &&
      motivatedActorGrantManaRegenArr[offset] === 0 &&
      motivatedActorGrantManaArr[offset] <= 0
    );
  }

  function dropExhaustedGrants(actorIndex: number): void {
    for (let slot = MAX_AFFINITY_GRANTS_PER_ACTOR - 1; slot >= 0; slot--) {
      if (isExhaustedGrant(grantIndexFor(actorIndex, slot))) {
        removeGrantAt(actorIndex, slot);
      }
    }
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

  function applyGrantRegenForActorIndex(index: number): void {
    for (let slot = 0; slot < MAX_AFFINITY_GRANTS_PER_ACTOR; slot++) {
      const offset = grantIndexFor(index, slot);
      if (motivatedActorGrantKindArr[offset] <= 0) continue;
      const regen = motivatedActorGrantManaRegenArr[offset];
      if (regen <= 0) continue;
      const max = motivatedActorGrantManaMaxArr[offset];
      const current = motivatedActorGrantManaArr[offset];
      if (current < max) {
        motivatedActorGrantManaArr[offset] = Math.min(max, current + regen);
      }
    }
  }

  /**
   * Advance the exit-dwell counter, and retire any actor that has now left.
   *
   * CONSECUTIVE ticks, which is why the else-branch resets rather than decays: without
   * it an actor could bank a stray tick on the exit early in a run and leave much later
   * from somewhere else entirely.
   *
   * Counted at END of tick, so an actor that steps onto the exit during tick N has dwelt
   * ONE tick when N closes, and leaves when N+1 closes. That is what "two ticks" means
   * here, and the arithmetic is pinned by `tests/core-ts/exit-dwell.test.mts`.
   *
   * ⚠️ EXITING MUST VACATE THE CELL. The flag alone would leave the actor's body sitting
   * on the one tile every other actor paths toward — which is the defect this rule exists
   * to end (#169: 579 ActorCollision rejections in a 100-tick run, three actors that never
   * moved). Releasing occupancy is the observable half; a test asserts it directly.
   */
  function applyExitDwell(): void {
    if (exitX < 0 || exitY < 0) return;
    for (let i = 0; i < motivatedActorCount; i++) {
      if (motivatedActorExitedArr[i] !== 0) continue;
      if (motivatedActorXArr[i] === exitX && motivatedActorYArr[i] === exitY) {
        motivatedActorExitDwellArr[i] += 1;
        if (motivatedActorExitDwellArr[i] >= EXIT_DWELL_TICKS) {
          motivatedActorExitedArr[i] = 1;
          setMotivatedOccupancyAt(exitX, exitY, 0);
        }
      } else {
        motivatedActorExitDwellArr[i] = 0;
      }
    }
  }

  function applyTickRegen(): void {
    if (motivatedActorCount > 0) {
      for (let i = 0; i < motivatedActorCount; i++) {
        applyRegenForActorIndex(i);
        applyGrantRegenForActorIndex(i);
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
      // AM.2 — seed the motivated actor's vitals FROM the singleton mirror.
      //
      // This promotes the singleton into motivated actor 0, but it used to copy
      // only id and position, leaving the motivated vital arrays at zero while
      // the mirror held the real values. The two disagreed from that moment on.
      // Nothing noticed because nothing ever re-synced the mirror — the sync
      // direction is motivated -> mirror, and it was only ever run at placement.
      // Now that a move repoints the mirror to its own actor, an unseeded array
      // would overwrite live vitals with zeros (callers set vitals BEFORE
      // spawning: see loadMvpScenario). Seeding here keeps the two
      // representations equal at the one point where one becomes the other.
      for (let kind = 0; kind < VITAL_COUNT; kind++) {
        const offset = vitalIndexFor(0, kind);
        motivatedActorVitalCurrent[offset] = actorVitalCurrent[kind];
        motivatedActorVitalMax[offset] = actorVitalMax[kind];
        motivatedActorVitalRegen[offset] = actorVitalRegen[kind];
      }
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

    getMotivatedActorExitDwellByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? motivatedActorExitDwellArr[index] : 0;
    },

    isMotivatedActorExitedByIndex(index: number): boolean {
      return isValidMotivatedActorIndex(index) && motivatedActorExitedArr[index] !== 0;
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
      applyExitDwell();
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

    /** A resource exists if it carries a vital payload, an affinity payload, or both. */
    hasResourceAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      const idx = indexFor(x, y);
      const hasVital = resourceVitalKindByCell[idx] !== RESOURCE_VITAL_NONE;
      const hasAffinity = resourceAffinityKindByCell[idx] > 0;
      return hasVital || hasAffinity ? 1 : 0;
    },

    /**
     * Places a vital payload: mode 0 raises the current vital, 1/2 raise its max.
     *
     * `regen` is a third, independent grant handed over on top of the delta whatever
     * the mode — it is not governed by it. A granted rate is permanent: actors hold
     * vital regen as a plain rate with no pool and no expiry.
     */
    placeResourceAt(
      x: number,
      y: number,
      vitalKind: number,
      delta: number,
      mode: number,
      regen?: number,
    ): number {
      if (!withinBounds(x, y)) return 0;
      if (!isValidVitalKind(vitalKind)) return 0;
      if (!Number.isFinite(delta)) return 0;
      if (!Number.isFinite(mode) || mode < 0 || mode > 2) return 0;
      const resolvedRegen = regen === undefined ? 0 : regen;
      if (!Number.isFinite(resolvedRegen) || resolvedRegen < 0) return 0;
      const idx = indexFor(x, y);
      const wasEmpty = this.hasResourceAt(x, y) === 0;
      resourceVitalKindByCell[idx] = vitalKind;
      resourceDeltaByCell[idx] = delta;
      resourceModeByCell[idx] = mode;
      resourceVitalRegenByCell[idx] = resolvedRegen;
      if (wasEmpty) resourceCount++;
      return 1;
    },

    getResourceVitalRegenAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceVitalRegenByCell[indexFor(x, y)];
    },

    /**
     * Places an affinity payload. mana and manaRegen ride through to the grant an
     * actor receives on pass-over, so the resource's tier stays derived: mana-only
     * grants temporary affinity, mana + regen grants permanent affinity.
     */
    placeAffinityResourceAt(
      x: number,
      y: number,
      kind: number,
      expression: number,
      stacks: number,
      mana: number,
      manaRegen: number,
    ): number {
      if (!withinBounds(x, y)) return 0;
      if (!isValidAffinityKind(kind)) return 0;
      if (!isValidAffinityExpression(expression)) return 0;
      if (!Number.isFinite(stacks) || stacks <= 0) return 0;
      if (!Number.isFinite(mana) || mana < 0) return 0;
      if (!Number.isFinite(manaRegen) || manaRegen < 0) return 0;
      const idx = indexFor(x, y);
      const wasEmpty = this.hasResourceAt(x, y) === 0;
      resourceAffinityKindByCell[idx] = kind;
      resourceAffinityExpressionByCell[idx] = expression;
      resourceAffinityStacksByCell[idx] = stacks;
      resourceManaByCell[idx] = mana;
      resourceManaRegenByCell[idx] = manaRegen;
      if (wasEmpty) resourceCount++;
      return 1;
    },

    getResourceAffinityKindAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceAffinityKindByCell[indexFor(x, y)];
    },

    getResourceAffinityExpressionAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceAffinityExpressionByCell[indexFor(x, y)];
    },

    getResourceAffinityStacksAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceAffinityStacksByCell[indexFor(x, y)];
    },

    getResourceManaAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceManaByCell[indexFor(x, y)];
    },

    getResourceManaRegenAt(x: number, y: number): number {
      if (!withinBounds(x, y)) return 0;
      return resourceManaRegenByCell[indexFor(x, y)];
    },

    /**
     * Grants an affinity to the ACTIVE motivated actor — the same active-actor
     * idiom setActorVital uses, which is how resource capture reaches an actor
     * from the movement rules.
     */
    grantActiveActorAffinity(
      kind: number,
      expression: number,
      stacks: number,
      mana: number,
      manaRegen: number,
    ): number {
      if (motivatedActorCount <= 0) return 0;
      return this.grantMotivatedActorAffinity(
        normalizedActiveMotivatedActorIndex(),
        kind,
        expression,
        stacks,
        mana,
        mana,
        manaRegen,
      );
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
      if (this.hasResourceAt(x, y) === 0) return;
      const idx = indexFor(x, y);
      resourceVitalKindByCell[idx] = RESOURCE_VITAL_NONE;
      resourceDeltaByCell[idx] = 0;
      resourceModeByCell[idx] = 0;
      resourceVitalRegenByCell[idx] = 0;
      resourceAffinityKindByCell[idx] = 0;
      resourceAffinityExpressionByCell[idx] = 0;
      resourceAffinityStacksByCell[idx] = 0;
      resourceManaByCell[idx] = 0;
      resourceManaRegenByCell[idx] = 0;
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

    /**
     * DS.3 — how far an actor standing on this tile can see.
     *
     * READS the affinity field; never recomputes it. The field is rebuilt once
     * per tick under the Moderator's `planTickClose`, and its opposite-kind
     * cancellation has already run, so at most one of {Light, Dark} survives
     * here. The policy itself lives in `state/visibility.ts` — this method only
     * supplies the two numbers it needs.
     */
    getVisibilityRadiusAt(x: number, y: number): number {
      // Reads the closure arrays directly rather than via `this`, so the method
      // survives being detached onto the `core.*` surface without a bind — the
      // same reason every other accessor here is written this way.
      const readStacks = (kind: number): number => (
        isValidFieldArgs(x, y, kind) ? affinityFieldStacks[fieldIndexFor(x, y, kind)] : 0
      );
      return resolveVisibilityRadius({
        lightStacks: readStacks(SIGHT_AFFINITY_KINDS.LIGHT),
        darkStacks: readStacks(SIGHT_AFFINITY_KINDS.DARK),
      });
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

    // ── Motivated actor affinity grants ──

    /**
     * Appends an affinity grant to an actor. manaMax defaults to mana (mirroring
     * armStaticHazardAt), so a grant with no pool (mana 0) is innate.
     *
     * Appending never mutates an existing grant. Only when every slot is occupied
     * does the grant merge into a slot with the same kind, expression, and
     * regen-ness; with no such slot the grant is rejected.
     */
    grantMotivatedActorAffinity(
      index: number,
      kind: number,
      expression: number,
      stacks: number,
      mana: number,
      manaMax?: number,
      manaRegen?: number,
    ): number {
      if (!isValidMotivatedActorIndex(index)) return 0;
      if (!isValidAffinityKind(kind)) return 0;
      if (!isValidAffinityExpression(expression)) return 0;
      if (!Number.isFinite(stacks) || stacks <= 0) return 0;
      if (!Number.isFinite(mana) || mana < 0) return 0;

      const resolvedMax = manaMax === undefined ? mana : manaMax;
      const resolvedRegen = manaRegen === undefined ? 0 : manaRegen;
      if (!Number.isFinite(resolvedMax) || resolvedMax < 0) return 0;
      if (!Number.isFinite(resolvedRegen) || resolvedRegen < 0) return 0;

      for (let slot = 0; slot < MAX_AFFINITY_GRANTS_PER_ACTOR; slot++) {
        const offset = grantIndexFor(index, slot);
        if (motivatedActorGrantKindArr[offset] > 0) continue;
        motivatedActorGrantKindArr[offset] = kind;
        motivatedActorGrantExpressionArr[offset] = expression;
        motivatedActorGrantStacksArr[offset] = stacks;
        motivatedActorGrantManaArr[offset] = mana;
        motivatedActorGrantManaMaxArr[offset] = resolvedMax;
        motivatedActorGrantManaRegenArr[offset] = resolvedRegen;
        return 1;
      }

      // Slots full — merge into a like-for-like grant rather than lose the pickup.
      for (let slot = 0; slot < MAX_AFFINITY_GRANTS_PER_ACTOR; slot++) {
        const offset = grantIndexFor(index, slot);
        if (motivatedActorGrantKindArr[offset] !== kind) continue;
        if (motivatedActorGrantExpressionArr[offset] !== expression) continue;
        const existingRegenerates = motivatedActorGrantManaRegenArr[offset] > 0;
        if (existingRegenerates !== resolvedRegen > 0) continue;
        motivatedActorGrantStacksArr[offset] += stacks;
        motivatedActorGrantManaArr[offset] += mana;
        motivatedActorGrantManaMaxArr[offset] += resolvedMax;
        return 1;
      }
      return 0;
    },

    /**
     * Drains `amount` mana from an actor's grants of `kind`, returning how much was
     * actually drained. Temporary grants drain before permanent ones so the
     * perishable grant is spent first; innate grants have no pool and never drain.
     * Grants emptied by the spend are removed whole.
     */
    spendMotivatedActorAffinityMana(
      index: number,
      kind: number,
      amount: number,
    ): number {
      if (!isValidMotivatedActorIndex(index)) return 0;
      if (!isValidAffinityKind(kind)) return 0;
      if (!Number.isFinite(amount) || amount <= 0) return 0;

      let remaining = amount;
      // Pass 0: temporary grants (regen 0). Pass 1: permanent grants (regen > 0).
      for (let pass = 0; pass < 2 && remaining > 0; pass++) {
        for (let slot = 0; slot < MAX_AFFINITY_GRANTS_PER_ACTOR && remaining > 0; slot++) {
          const offset = grantIndexFor(index, slot);
          if (motivatedActorGrantKindArr[offset] !== kind) continue;
          if (motivatedActorGrantManaMaxArr[offset] === 0) continue; // innate: no pool
          const regenerates = motivatedActorGrantManaRegenArr[offset] > 0;
          if (regenerates !== (pass === 1)) continue;
          const available = motivatedActorGrantManaArr[offset];
          if (available <= 0) continue;
          const drained = Math.min(available, remaining);
          motivatedActorGrantManaArr[offset] = available - drained;
          remaining -= drained;
        }
      }
      dropExhaustedGrants(index);
      return amount - remaining;
    },

    /** Effective magnitude for a kind: the sum of stacks across contributing grants. */
    getMotivatedActorAffinityStacksForKind(index: number, kind: number): number {
      if (!isValidMotivatedActorIndex(index)) return 0;
      if (!isValidAffinityKind(kind)) return 0;
      let total = 0;
      if (motivatedActorAffinityKindArr[index] === kind) {
        total += motivatedActorAffinityStacksArr[index];
      }
      for (let slot = 0; slot < MAX_AFFINITY_GRANTS_PER_ACTOR; slot++) {
        const offset = grantIndexFor(index, slot);
        if (motivatedActorGrantKindArr[offset] !== kind) continue;
        if (!grantContributes(offset)) continue;
        total += motivatedActorGrantStacksArr[offset];
      }
      return total;
    },

    getMotivatedActorAffinityGrantCountByIndex(index: number): number {
      return isValidMotivatedActorIndex(index) ? grantSlotCount(index) : 0;
    },

    getMotivatedActorAffinityGrantKindAt(index: number, slot: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidGrantSlot(slot)) return 0;
      return motivatedActorGrantKindArr[grantIndexFor(index, slot)];
    },

    getMotivatedActorAffinityGrantExpressionAt(index: number, slot: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidGrantSlot(slot)) return 0;
      return motivatedActorGrantExpressionArr[grantIndexFor(index, slot)];
    },

    getMotivatedActorAffinityGrantStacksAt(index: number, slot: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidGrantSlot(slot)) return 0;
      return motivatedActorGrantStacksArr[grantIndexFor(index, slot)];
    },

    getMotivatedActorAffinityGrantManaAt(index: number, slot: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidGrantSlot(slot)) return 0;
      return motivatedActorGrantManaArr[grantIndexFor(index, slot)];
    },

    getMotivatedActorAffinityGrantManaMaxAt(index: number, slot: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidGrantSlot(slot)) return 0;
      return motivatedActorGrantManaMaxArr[grantIndexFor(index, slot)];
    },

    getMotivatedActorAffinityGrantManaRegenAt(index: number, slot: number): number {
      if (!isValidMotivatedActorIndex(index) || !isValidGrantSlot(slot)) return 0;
      return motivatedActorGrantManaRegenArr[grantIndexFor(index, slot)];
    },
  };
}
