import { ROOM_AFFINITY_EMIT_PERCENT_PER_STACK } from "../../contracts/domain-constants.js";
import { resolveAffinityRules } from "./affinity-rules.js";
import { computeInternalManaUpkeep } from "./cost-model.js";

const ROOM_AFFINITY_ASSIGNMENT_SEED_XOR = 0x9e3779b9;

function normalizePositiveInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeNonNegativeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

function normalizeAffinityKind(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim().toLowerCase();
}

function createRng(seed = 0) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithRng(list, rng) {
  const values = list.slice();
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
}

function roomContainsPoint(room, point) {
  if (!room || !point) return false;
  return (
    point.x >= room.x
    && point.x < room.x + room.width
    && point.y >= room.y
    && point.y < room.y + room.height
  );
}

function resolveRoomId(room, index) {
  if (typeof room?.id === "string" && room.id.trim()) return room.id.trim();
  return `R${index + 1}`;
}

function buildMixedRoomTemplateMap(affinityRules) {
  const templates = affinityRules?.worldActorCostModel?.mixedRoomAssembly?.templates;
  if (!Array.isArray(templates) || templates.length === 0) return new Map();
  const map = new Map();
  templates.forEach((template) => {
    const id = typeof template?.id === "string" ? template.id.trim() : "";
    if (id) map.set(id, template);
  });
  return map;
}

function buildMixedRoomProfilesFromCardSet(cardSet, templateMap) {
  if (!Array.isArray(cardSet) || cardSet.length === 0 || templateMap.size === 0) return [];
  const profiles = [];
  cardSet.forEach((card) => {
    const type = typeof card?.type === "string" ? card.type.trim().toLowerCase() : "";
    const source = typeof card?.source === "string" ? card.source.trim().toLowerCase() : "";
    if (type !== "room" && source !== "room") return;
    const templateId = typeof card?.id === "string" ? card.id.trim() : "";
    const template = templateMap.get(templateId);
    if (!template) return;
    const count = Math.max(1, normalizePositiveInt(card?.count, 1));
    for (let i = 0; i < count; i += 1) {
      profiles.push({ templateId, templateInstanceId: `${templateId}-${i + 1}`, template });
    }
  });
  return profiles;
}

function normalizeMixedRoomOverlay(overlay) {
  if (!overlay || typeof overlay !== "object") return undefined;
  const kind = normalizeAffinityKind(overlay.kind);
  if (!kind) return undefined;
  return {
    kind,
    expression: typeof overlay.expression === "string" && overlay.expression.trim()
      ? overlay.expression.trim().toLowerCase()
      : "emit",
    stacks: Math.max(1, normalizePositiveInt(overlay.stacks, 1)),
  };
}

function normalizeMixedRoomLocalizedTiles(localizedTiles) {
  if (!Array.isArray(localizedTiles)) return [];
  return localizedTiles
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      x: normalizeNonNegativeInt(entry.x, 0),
      y: normalizeNonNegativeInt(entry.y, 0),
      kind: typeof entry.kind === "string" && entry.kind.trim()
        ? entry.kind.trim().toLowerCase()
        : "floor",
    }));
}

function normalizeMixedRoomLocalizedHazards(localizedHazards) {
  if (!Array.isArray(localizedHazards)) return [];
  return localizedHazards
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const affinityKind = normalizeAffinityKind(entry?.affinity?.kind);
      if (!affinityKind) return null;
      const stacks = Math.max(1, normalizePositiveInt(entry?.affinity?.stacks, 1));
      return {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `hazard_${index + 1}`,
        x: normalizeNonNegativeInt(entry.x, 0),
        y: normalizeNonNegativeInt(entry.y, 0),
        blocking: entry.blocking === true,
        affinity: {
          kind: affinityKind,
          expression: typeof entry?.affinity?.expression === "string" && entry.affinity.expression.trim()
            ? entry.affinity.expression.trim().toLowerCase()
            : "emit",
          stacks,
        },
        manaReserve: normalizeNonNegativeInt(
          entry.manaReserve,
          ROOM_AFFINITY_EMIT_PERCENT_PER_STACK * stacks,
        ),
        manaRegen: normalizeNonNegativeInt(entry.manaRegen, 0),
      };
    })
    .filter(Boolean);
}

function deriveMixedRoomCompositionProfile({ roomWideOverlay, localizedTiles, localizedHazards }) {
  if (roomWideOverlay && localizedHazards.length > 0) {
    return "room_overlay_dominant_with_localized_variation";
  }
  if (roomWideOverlay) return "room_overlay_dominant";
  if (localizedHazards.length > 0) return "neutral_with_localized_hazards";
  return "mixed_composition";
}

function deriveMixedRoomDominantInvestment({ roomWideOverlay, localizedTiles, localizedHazards }) {
  if (roomWideOverlay) return "room_wide_overlay";
  if (localizedHazards.length > 0) return "localized_hazards";
  if (localizedTiles.length > 0) return "localized_tiles";
  return "default_tiles";
}

function buildMixedRoomComposition({ templateId, templateInstanceId, template }) {
  const roomWideOverlay = normalizeMixedRoomOverlay(template?.roomWideOverlay);
  const localizedTiles = normalizeMixedRoomLocalizedTiles(template?.localizedTiles);
  const localizedHazards = normalizeMixedRoomLocalizedHazards(template?.localizedHazards);
  return {
    templateId,
    templateInstanceId,
    compositionProfile: deriveMixedRoomCompositionProfile({
      roomWideOverlay,
      localizedTiles,
      localizedHazards,
    }),
    dominantInvestment: deriveMixedRoomDominantInvestment({
      roomWideOverlay,
      localizedTiles,
      localizedHazards,
    }),
    localizedTiles,
    roomWideOverlay,
    localizedHazards,
  };
}

function collectMixedRoomTemplateHazards({
  room,
  roomIndex,
  templateId,
  templateInstanceId,
  composition,
  occupied,
  spawnKey,
  exitKey,
}) {
  const localizedHazards = Array.isArray(composition?.localizedHazards) ? composition.localizedHazards : [];
  const roomId = resolveRoomId(room, roomIndex);
  const generated = [];
  localizedHazards.forEach((hazard) => {
    const x = room.x + hazard.x;
    const y = room.y + hazard.y;
    const point = { x, y };
    if (!roomContainsPoint(room, point)) return;
    const key = `${x},${y}`;
    if (key === spawnKey || key === exitKey || occupied.has(key)) return;
    const reserve = normalizeNonNegativeInt(hazard.manaReserve, 0);
    generated.push({
      id: hazard.id,
      x,
      y,
      blocking: hazard.blocking === true,
      source: "mixed_room_template",
      roomId,
      templateId,
      templateInstanceId,
      affinity: { ...hazard.affinity, targetType: "floor" },
      vitals: {
        mana: {
          current: reserve,
          max: reserve,
          regen: normalizeNonNegativeInt(hazard.manaRegen, 0),
        },
      },
    });
    occupied.add(key);
  });
  return generated;
}

function buildCardAffinityProfiles(cardSet) {
  if (!Array.isArray(cardSet) || cardSet.length === 0) return [];
  const profiles = [];
  cardSet.forEach((card) => {
    const type = typeof card?.type === "string" ? card.type.trim().toLowerCase() : "";
    const source = typeof card?.source === "string" ? card.source.trim().toLowerCase() : "";
    if (type !== "room" && source !== "room") return;
    const emitAffinities = (Array.isArray(card?.affinities) ? card.affinities : [])
      .map((affinity) => {
        const kind = normalizeAffinityKind(affinity?.kind);
        const expression = typeof affinity?.expression === "string"
          ? affinity.expression.trim().toLowerCase()
          : "";
        if (!kind || expression !== "emit") return null;
        return { kind, stacks: Math.max(1, normalizePositiveInt(affinity.stacks, 1)) };
      })
      .filter(Boolean);
    if (emitAffinities.length === 0) return;
    const count = Math.max(1, normalizePositiveInt(card?.count, 1));
    const templateId = typeof card?.id === "string" && card.id.trim()
      ? card.id.trim()
      : `card_room_${profiles.length + 1}`;
    for (let i = 0; i < count; i += 1) {
      profiles.push({ templateId, templateInstanceId: `${templateId}-${i + 1}`, emitAffinities });
    }
  });
  return profiles;
}

function collectCardAffinityHazards({
  profile,
  room,
  roomIndex,
  occupied,
  spawnKey,
  exitKey,
  assignmentRng,
}) {
  const generated = [];
  const roomId = resolveRoomId(room, roomIndex);
  profile.emitAffinities.forEach(({ kind, stacks }) => {
    const candidates = [];
    for (let dy = 0; dy < room.height; dy += 1) {
      for (let dx = 0; dx < room.width; dx += 1) {
        const x = room.x + dx;
        const y = room.y + dy;
        const key = `${x},${y}`;
        if (key === spawnKey || key === exitKey || occupied.has(key)) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;
    const chosen = candidates[Math.floor(assignmentRng() * candidates.length)];
    const upkeep = computeInternalManaUpkeep(stacks);
    const manaPool = upkeep * 3;
    const durability = stacks * 5;
    generated.push({
      id: `${kind}_emit_${roomIndex}`,
      x: chosen.x,
      y: chosen.y,
      blocking: false,
      source: "room_affinity_tile",
      roomId,
      affinity: { kind, expression: "emit", stacks, targetType: "floor" },
      vitals: {
        mana: { current: manaPool, max: manaPool, regen: upkeep },
        durability: { current: durability, max: durability, regen: 0 },
      },
    });
    occupied.add(`${chosen.x},${chosen.y}`);
  });
  return generated;
}

/**
 * Deterministically assign room profiles and synthesize their affinity hazards.
 * This capability is pure: caller-owned layout data is never mutated.
 */
export function composeMixedRooms({ layout, cardSet, seed = 0, affinityRules = null } = {}) {
  if (!layout || !Array.isArray(layout.rooms) || layout.rooms.length === 0) {
    return { layout, generatedHazardCount: 0 };
  }

  const templateMap = buildMixedRoomTemplateMap(affinityRules || resolveAffinityRules());
  let profiles = templateMap.size > 0 ? buildMixedRoomProfilesFromCardSet(cardSet, templateMap) : [];
  const useCardAffinityFallback = profiles.length === 0;
  if (useCardAffinityFallback) profiles = buildCardAffinityProfiles(cardSet);
  if (profiles.length === 0) return { layout, generatedHazardCount: 0 };

  const normalizedSeed = Number.isFinite(seed) ? Math.floor(seed) : 0;
  const assignmentRng = createRng((normalizedSeed ^ ROOM_AFFINITY_ASSIGNMENT_SEED_XOR) >>> 0);
  const roomOrder = shuffleWithRng(layout.rooms.map((_, index) => index), assignmentRng);
  const nextRooms = layout.rooms.map((room) => ({ ...room }));
  const existingHazards = Array.isArray(layout.hazards)
    ? layout.hazards.map((hazard) => ({ ...hazard }))
    : [];
  const occupied = new Set(
    existingHazards
      .filter((hazard) => Number.isFinite(hazard?.x) && Number.isFinite(hazard?.y))
      .map((hazard) => `${hazard.x},${hazard.y}`),
  );
  const spawnKey = Number.isFinite(layout?.spawn?.x) && Number.isFinite(layout?.spawn?.y)
    ? `${layout.spawn.x},${layout.spawn.y}`
    : "";
  const exitKey = Number.isFinite(layout?.exit?.x) && Number.isFinite(layout?.exit?.y)
    ? `${layout.exit.x},${layout.exit.y}`
    : "";
  const generatedHazards = [];

  roomOrder.forEach((roomIndex, orderIndex) => {
    const profile = profiles[orderIndex % profiles.length];
    if (!profile) return;
    const room = nextRooms[roomIndex];

    if (useCardAffinityFallback) {
      const nextRoom = {
        ...room,
        templateId: profile.templateId,
        templateInstanceId: profile.templateInstanceId,
      };
      nextRooms[roomIndex] = nextRoom;
      generatedHazards.push(...collectCardAffinityHazards({
        profile,
        room: nextRoom,
        roomIndex,
        occupied,
        spawnKey,
        exitKey,
        assignmentRng,
      }));
      return;
    }

    const composition = buildMixedRoomComposition(profile);
    const nextRoom = {
      ...room,
      templateId: profile.templateId,
      templateInstanceId: profile.templateInstanceId,
      mixedRoomComposition: composition,
    };
    nextRooms[roomIndex] = nextRoom;
    generatedHazards.push(...collectMixedRoomTemplateHazards({
      room: nextRoom,
      roomIndex,
      templateId: profile.templateId,
      templateInstanceId: profile.templateInstanceId,
      composition,
      occupied,
      spawnKey,
      exitKey,
    }));
  });

  return {
    layout: {
      ...layout,
      rooms: nextRooms,
      ...(generatedHazards.length > 0 || existingHazards.length > 0
        ? { hazards: [...existingHazards, ...generatedHazards] }
        : {}),
    },
    generatedHazardCount: generatedHazards.length,
  };
}
