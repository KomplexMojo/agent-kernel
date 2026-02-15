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
    shape: { profile: "rectangular" },
  };
}

function normalizePositiveInt(value, fallback = 1) {
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

const LAYOUT_SHAPE_PROFILES = Object.freeze(["rectangular", "sparse_islands", "clustered_islands", "rooms"]);
const WALKABLE_DENSITY_TARGETS = Object.freeze({
  rectangular: 0.7,
  rooms: 0.55,
  clustered_islands: 0.45,
  sparse_islands: 0.35,
});

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

function deriveRoomShapeFromDesign(roomDesign, { width, height } = {}) {
  if (!roomDesign || typeof roomDesign !== "object" || Array.isArray(roomDesign)) {
    return null;
  }
  const rooms = Array.isArray(roomDesign.rooms)
    ? roomDesign.rooms.filter((room) => room && typeof room === "object" && !Array.isArray(room))
    : [];
  if (rooms.length === 0) {
    return null;
  }

  const minSide = Math.max(1, Math.min(width, height) - 2);
  let roomMinSize = null;
  let roomMaxSize = null;

  rooms.forEach((room) => {
    const roomWidth = Number.isInteger(room.width) && room.width > 0 ? room.width : null;
    const roomHeight = Number.isInteger(room.height) && room.height > 0 ? room.height : null;
    if (!roomWidth || !roomHeight) return;
    const localMin = Math.min(roomWidth, roomHeight);
    const localMax = Math.max(roomWidth, roomHeight);
    roomMinSize = roomMinSize === null ? localMin : Math.min(roomMinSize, localMin);
    roomMaxSize = roomMaxSize === null ? localMax : Math.max(roomMaxSize, localMax);
  });

  const normalizedRoomMin = normalizePositiveInt(roomMinSize, 3);
  const normalizedRoomMax = normalizePositiveInt(roomMaxSize, normalizedRoomMin);
  const clampedRoomMin = Math.max(1, Math.min(minSide, normalizedRoomMin));
  const clampedRoomMax = Math.max(clampedRoomMin, Math.min(minSide, normalizedRoomMax));

  return {
    profile: "rooms",
    roomCount: normalizePositiveInt(rooms.length, 1),
    roomMinSize: clampedRoomMin,
    roomMaxSize: clampedRoomMax,
    corridorWidth: normalizePositiveInt(readShapeField(roomDesign, "corridorWidth"), 1),
  };
}

function deriveProfileShapeFromDesign(roomDesign, { width, height } = {}) {
  const profileRaw = readShapeField(roomDesign, "profile");
  if (typeof profileRaw !== "string") {
    return null;
  }
  const profile = profileRaw.trim();
  if (!LAYOUT_SHAPE_PROFILES.includes(profile)) {
    return null;
  }

  if (profile === "rooms") {
    return deriveRoomShapeFromDesign(roomDesign, { width, height }) || { profile: "rooms" };
  }

  if (profile === "sparse_islands") {
    const density = readShapeField(roomDesign, "density");
    const shape = { profile };
    if (typeof density === "number" && !Number.isNaN(density) && density >= 0 && density <= 1) {
      shape.density = density;
    }
    return shape;
  }

  if (profile === "clustered_islands") {
    const clusterSize = readShapeField(roomDesign, "clusterSize");
    const shape = { profile };
    if (Number.isInteger(clusterSize) && clusterSize > 0) {
      shape.clusterSize = clusterSize;
    }
    return shape;
  }

  return { profile: "rectangular" };
}

function inferLayoutProfile(roomDesign) {
  const explicitProfile = readShapeField(roomDesign, "profile");
  if (typeof explicitProfile === "string") {
    const profile = explicitProfile.trim();
    if (LAYOUT_SHAPE_PROFILES.includes(profile)) {
      return profile;
    }
  }
  const rooms = Array.isArray(roomDesign?.rooms) ? roomDesign.rooms : [];
  return rooms.length > 0 ? "rooms" : "rectangular";
}

function normalizeLayoutTiles(layout = {}) {
  const wallTiles = Number.isInteger(layout.wallTiles) && layout.wallTiles > 0 ? layout.wallTiles : 0;
  let floorTiles = Number.isInteger(layout.floorTiles) && layout.floorTiles > 0 ? layout.floorTiles : 0;
  let hallwayTiles = Number.isInteger(layout.hallwayTiles) && layout.hallwayTiles > 0 ? layout.hallwayTiles : 0;

  if (wallTiles > 0) {
    const walkableTiles = floorTiles + hallwayTiles;
    if (walkableTiles > 0) {
      const floorShare = Math.floor((wallTiles * floorTiles) / walkableTiles);
      const hallwayShare = wallTiles - floorShare;
      floorTiles += floorShare;
      hallwayTiles += hallwayShare;
    } else {
      const floorShare = Math.ceil(wallTiles / 2);
      floorTiles = floorShare;
      hallwayTiles = wallTiles - floorShare;
    }
  }

  return { floorTiles, hallwayTiles };
}

function resolveWalkableDensityTarget(profile) {
  const key = typeof profile === "string" ? profile.trim() : "";
  const density = WALKABLE_DENSITY_TARGETS[key];
  return typeof density === "number" && density > 0 && density <= 1 ? density : WALKABLE_DENSITY_TARGETS.rectangular;
}

function deriveLevelSideForWalkableTiles(totalTiles, profile = "rectangular") {
  const normalizedTotalTiles = Number.isInteger(totalTiles) && totalTiles > 0 ? totalTiles : 1;
  const densityTarget = resolveWalkableDensityTarget(profile);
  const interiorArea = Math.ceil(normalizedTotalTiles / densityTarget);
  const interiorSide = Math.ceil(Math.sqrt(interiorArea));
  return Math.max(5, interiorSide + 2);
}

function deriveLevelGenFromLayout(layout = {}, roomDesign) {
  const { floorTiles, hallwayTiles } = normalizeLayoutTiles(layout);
  const totalTiles = floorTiles + hallwayTiles;
  const profile = inferLayoutProfile(roomDesign);
  const size = deriveLevelSideForWalkableTiles(totalTiles, profile);
  const profileShape = deriveProfileShapeFromDesign(roomDesign, { width: size, height: size });
  const roomShape = profileShape || deriveRoomShapeFromDesign(roomDesign, { width: size, height: size });
  const levelGen = {
    width: size,
    height: size,
    shape: roomShape || { profile: "rectangular" },
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
  const levelGen = layout ? deriveLevelGenFromLayout(layout, roomDesign) : deriveLevelGen({ roomCount });
  const attackerConfig = summary?.attackerConfig && typeof summary.attackerConfig === "object"
    ? { ...summary.attackerConfig }
    : null;

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
        attackerConfig: attackerConfig || undefined,
      },
    },
    configurator: {
      inputs: {
        levelGen,
        levelAffinity: summary?.dungeonAffinity,
        actors,
        actorGroups,
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
