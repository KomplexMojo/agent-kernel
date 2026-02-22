import { mapSummaryToPool } from "./pool-mapper.js";
import { buildSelectionsFromSummary } from "./summary-selections.js";
import { validateBuildSpec } from "../../contracts/build-spec.js";
import {
  DEFAULT_VITALS,
  normalizeVitals as normalizeDomainVitals,
} from "../../contracts/domain-constants.js";

function defaultMeta({ runId, source, createdAt, summary }) {
  const dungeonAffinity = summary?.dungeonAffinity || "unknown";
  const id = runId || `pool_${dungeonAffinity}`;
  return {
    id,
    runId: runId || id,
    createdAt: createdAt || new Date().toISOString(),
    source: source || "director-pool",
  };
}

export function deriveLevelGen({ roomCount }) {
  const size = Math.max(5, roomCount * 2 + 5);
  return {
    width: size,
    height: size,
    shape: {
      roomCount: normalizePositiveInt(roomCount, 1),
    },
  };
}

function normalizePositiveInt(value, fallback = 1) {
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

const WALKABLE_DENSITY_TARGET = 0.5;

function readShapeField(roomDesign, field) {
  if (!roomDesign || typeof roomDesign !== "object" || Array.isArray(roomDesign)) {
    return undefined;
  }
  if (roomDesign[field] !== undefined) {
    return roomDesign[field];
  }
  const nested = roomDesign.shape;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested[field];
  }
  return undefined;
}

const SHAPE_PATTERN_TYPES = new Set(["none", "grid", "diagonal_grid", "concentric_circles"]);

function normalizeShapePattern(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "horizontal_vertical_grid" || normalized === "horizontal_verticle_grid") {
    return "grid";
  }
  if (normalized === "diagonal") {
    return "diagonal_grid";
  }
  if (normalized === "concentric") {
    return "concentric_circles";
  }
  return SHAPE_PATTERN_TYPES.has(normalized) ? normalized : "";
}

function deriveRoomShapeFromDesign(roomDesign, { width, height } = {}) {
  if (!roomDesign || typeof roomDesign !== "object" || Array.isArray(roomDesign)) return null;
  const minSide = Math.max(1, Math.min(width, height) - 2);
  const rooms = Array.isArray(roomDesign.rooms)
    ? roomDesign.rooms.filter((room) => room && typeof room === "object" && !Array.isArray(room))
    : [];

  let roomMinSize = null;
  let roomMaxSize = null;

  rooms.forEach((room) => {
    let roomWidth = Number.isInteger(room.width) && room.width > 0 ? room.width : null;
    let roomHeight = Number.isInteger(room.height) && room.height > 0 ? room.height : null;
    if ((!roomWidth || !roomHeight)
      && Number.isInteger(room.startX)
      && Number.isInteger(room.startY)
      && Number.isInteger(room.endX)
      && Number.isInteger(room.endY)
      && room.endX >= room.startX
      && room.endY >= room.startY) {
      roomWidth = room.endX - room.startX + 1;
      roomHeight = room.endY - room.startY + 1;
    }
    if (!roomWidth || !roomHeight) return;
    const localMin = Math.min(roomWidth, roomHeight);
    const localMax = Math.max(roomWidth, roomHeight);
    roomMinSize = roomMinSize === null ? localMin : Math.min(roomMinSize, localMin);
    roomMaxSize = roomMaxSize === null ? localMax : Math.max(roomMaxSize, localMax);
  });

  const roomCountFromRooms = rooms.length > 0 ? rooms.length : null;
  const totalRoomsInput = normalizePositiveInt(readShapeField(roomDesign, "totalRooms"), 0);
  const roomCountInput = normalizePositiveInt(readShapeField(roomDesign, "roomCount"), 0);
  const normalizedRoomCount = normalizePositiveInt(
    roomCountFromRooms ?? (totalRoomsInput || roomCountInput),
    1,
  );
  const roomMinInput = normalizePositiveInt(readShapeField(roomDesign, "roomMinSize"), 0);
  const roomMaxInput = normalizePositiveInt(readShapeField(roomDesign, "roomMaxSize"), 0);
  const normalizedRoomMin = normalizePositiveInt(roomMinSize ?? roomMinInput, 3);
  const normalizedRoomMax = normalizePositiveInt(roomMaxSize ?? roomMaxInput, normalizedRoomMin);
  const clampedRoomMin = Math.max(1, Math.min(minSide, normalizedRoomMin));
  const clampedRoomMax = Math.max(clampedRoomMin, Math.min(minSide, normalizedRoomMax));

  const shape = {
    roomCount: normalizedRoomCount,
    roomMinSize: clampedRoomMin,
    roomMaxSize: clampedRoomMax,
    corridorWidth: normalizePositiveInt(readShapeField(roomDesign, "corridorWidth"), 1),
  };
  const pattern = readShapeField(roomDesign, "pattern");
  const normalizedPattern = normalizeShapePattern(pattern);
  if (normalizedPattern) {
    shape.pattern = normalizedPattern;
  }
  const patternSpacing = normalizePositiveInt(readShapeField(roomDesign, "patternSpacing"), 0);
  if (patternSpacing > 0) shape.patternSpacing = patternSpacing;
  const patternLineWidth = normalizePositiveInt(readShapeField(roomDesign, "patternLineWidth"), 0);
  if (patternLineWidth > 0) shape.patternLineWidth = patternLineWidth;
  const patternGapEvery = normalizePositiveInt(readShapeField(roomDesign, "patternGapEvery"), 0);
  if (patternGapEvery > 0) shape.patternGapEvery = patternGapEvery;
  const patternInset = readShapeField(roomDesign, "patternInset");
  if (Number.isInteger(patternInset) && patternInset >= 0) {
    shape.patternInset = patternInset;
  }
  const patternInfillPercent = normalizePositiveInt(readShapeField(roomDesign, "patternInfillPercent"), 0);
  if (patternInfillPercent > 0) {
    shape.patternInfillPercent = Math.min(100, patternInfillPercent);
  }
  return shape;
}

function normalizeLayoutTiles(layout = {}) {
  const floorTiles = Number.isInteger(layout.floorTiles) && layout.floorTiles > 0 ? layout.floorTiles : 0;
  const hallwayTiles = Number.isInteger(layout.hallwayTiles) && layout.hallwayTiles > 0 ? layout.hallwayTiles : 0;
  return { floorTiles, hallwayTiles };
}

function deriveLevelSideForWalkableTiles(totalTiles) {
  const normalizedTotalTiles = Number.isInteger(totalTiles) && totalTiles > 0 ? totalTiles : 1;
  const interiorArea = Math.ceil(normalizedTotalTiles / WALKABLE_DENSITY_TARGET);
  const interiorSide = Math.ceil(Math.sqrt(interiorArea));
  return Math.max(5, interiorSide + 2);
}

function deriveLevelGenFromLayout(layout = {}, roomDesign) {
  const { floorTiles, hallwayTiles } = normalizeLayoutTiles(layout);
  const totalFloorTilesUsed = normalizePositiveInt(readShapeField(roomDesign, "totalFloorTilesUsed"), 0);
  const totalTiles = floorTiles + hallwayTiles > 0 ? floorTiles + hallwayTiles : totalFloorTilesUsed;
  const size = deriveLevelSideForWalkableTiles(totalTiles);
  const roomShape = deriveRoomShapeFromDesign(roomDesign, { width: size, height: size });
  const levelGen = {
    width: size,
    height: size,
    shape: roomShape || {},
  };
  if (totalTiles > 0) {
    levelGen.walkableTilesTarget = totalTiles;
  }
  return levelGen;
}

function normalizeActorVitals(vitals) {
  return normalizeDomainVitals(vitals, DEFAULT_VITALS);
}

function normalizeAffinityTraits(affinities, fallbackAffinity) {
  const traits = {};
  if (Array.isArray(affinities)) {
    affinities.forEach((entry) => {
      const kind = typeof entry?.kind === "string" && entry.kind.trim() ? entry.kind.trim() : "";
      if (!kind) return;
      const stacks = Number.isFinite(entry?.stacks) ? Math.max(1, Math.floor(entry.stacks)) : 1;
      traits[kind] = Math.max(stacks, traits[kind] || 0);
    });
  }
  if (Object.keys(traits).length === 0 && fallbackAffinity) {
    traits[fallbackAffinity] = 1;
  }
  return Object.keys(traits).length > 0 ? traits : null;
}

function buildActorsAndGroups(selections) {
  const actors = [];
  const groupCounts = new Map();

  selections
    .filter((sel) => sel.kind === "actor" && sel.instances && sel.instances.length > 0)
    .forEach((sel) => {
      sel.instances.forEach((inst, idx) => {
        const vitals = normalizeActorVitals(inst?.vitals);
        const affinityTraits = normalizeAffinityTraits(inst?.affinities, inst?.affinity);
        const entry = {
          id: inst.id,
          kind: sel.applied?.subType === "static" ? "static" : "ambulatory",
          affinity: inst.affinity,
          motivations: [inst.motivation],
          position: { x: idx, y: 0 },
          tokenCost: Number.isInteger(inst?.cost) && inst.cost > 0 ? inst.cost : undefined,
          vitals,
        };
        if (typeof inst?.setupMode === "string" && inst.setupMode.trim()) {
          entry.setupMode = inst.setupMode.trim();
        }
        if (affinityTraits) {
          const baseTraits = inst?.traits && typeof inst.traits === "object" && !Array.isArray(inst.traits)
            ? { ...inst.traits }
            : {};
          entry.traits = { ...baseTraits, affinities: affinityTraits };
        }
        actors.push(entry);
      });
      const key = sel.applied?.motivation || "unknown";
      const prev = groupCounts.get(key) || 0;
      groupCounts.set(key, prev + sel.instances.length);
    });

  const actorGroups = Array.from(groupCounts.entries()).map(([role, count]) => ({ role, count }));

  return { actors, actorGroups };
}

export function buildBuildSpecFromSummary({
  summary,
  catalog,
  runId,
  source,
  createdAt,
  selections,
  budgetRef,
  priceListRef,
  budgetArtifact,
  priceListArtifact,
  receiptArtifact,
} = {}) {
  const mapped = selections
    ? { ok: true, selections }
    : catalog
      ? mapSummaryToPool({ summary, catalog })
      : { ok: true, selections: buildSelectionsFromSummary(summary) };
  if (!mapped.ok) {
    return { ok: false, errors: mapped.errors, spec: null, selections: mapped.selections || [] };
  }

  const rooms = mapped.selections.filter((sel) => sel.kind === "room");
  const roomCount = rooms.reduce((sum, sel) => sum + (sel.instances?.length || 0), 0);
  const { actors, actorGroups } = buildActorsAndGroups(mapped.selections);
  const layout = summary?.layout && typeof summary.layout === "object" ? summary.layout : null;
  const roomDesign = summary?.roomDesign && typeof summary.roomDesign === "object"
    ? summary.roomDesign
    : null;
  const levelGen = layout || roomDesign
    ? deriveLevelGenFromLayout(layout || {}, roomDesign)
    : deriveLevelGen({ roomCount });
  const attackerConfigs = Array.isArray(summary?.attackerConfigs)
    ? summary.attackerConfigs
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({ ...entry }))
    : summary?.attackerConfig && typeof summary.attackerConfig === "object"
      ? [{ ...summary.attackerConfig }]
      : [];
  const attackerConfig = attackerConfigs[0] || null;
  const attackerCount = Number.isInteger(summary?.attackerCount) && summary.attackerCount > 0
    ? summary.attackerCount
    : attackerConfigs.length > 0
      ? attackerConfigs.length
      : undefined;

  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: defaultMeta({ runId, source, createdAt, summary }),
    intent: {
      goal: summary?.goal || `Dungeon plan for ${summary?.dungeonAffinity || "unknown"}`,
      tags: summary?.tags || (summary?.dungeonAffinity ? [summary.dungeonAffinity] : []),
      hints: {
        levelAffinity: summary?.dungeonAffinity,
        budgetTokens: summary?.budgetTokens,
        attackerCount,
        attackerSetupMode: attackerConfig?.setupMode,
      },
    },
    plan: {
      hints: {
        rooms: rooms.map((sel) => ({
          motivation: sel.requested.motivation,
          affinity: sel.requested.affinity,
          count: sel.requested.count,
        })),
        attackerCount,
        attackerConfigs: attackerConfigs.length > 0 ? attackerConfigs : undefined,
        attackerConfig: attackerConfig || undefined,
      },
    },
    configurator: {
      inputs: {
        levelGen,
        levelAffinity: summary?.dungeonAffinity,
        actors,
        actorGroups,
        attackerCount,
        attackerConfigs: attackerConfigs.length > 0 ? attackerConfigs : undefined,
        attackerConfig: attackerConfig || undefined,
      },
    },
  };
  if (layout) {
    const normalizedLayout = normalizeLayoutTiles(layout);
    spec.plan.hints.layout = {
      floorTiles: normalizedLayout.floorTiles,
      hallwayTiles: normalizedLayout.hallwayTiles,
    };
  }
  if (budgetRef || priceListRef || budgetArtifact || priceListArtifact || receiptArtifact) {
    spec.budget = {};
    if (budgetRef) spec.budget.budgetRef = budgetRef;
    if (priceListRef) spec.budget.priceListRef = priceListRef;
    if (budgetArtifact) spec.budget.budget = budgetArtifact;
    if (priceListArtifact) spec.budget.priceList = priceListArtifact;
    if (receiptArtifact) spec.budget.receipt = receiptArtifact;
  }

  const validation = validateBuildSpec(spec);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      spec,
      selections: mapped.selections,
    };
  }

  return {
    ok: true,
    spec,
    selections: mapped.selections,
  };
}
