import { resolveAffinityRules } from "../personas/configurator/affinity-rules.js";

const DEFAULT_TOKEN_SPEND = Object.freeze({
  defaultTiles: 0,
  localizedTiles: 0,
  roomWideOverlay: 0,
  localizedTraps: 0,
  total: 0,
});

const MIXED_ROOM_TEMPLATE_MAP = (() => {
  try {
    const rules = resolveAffinityRules();
    const templates = rules?.worldActorCostModel?.mixedRoomAssembly?.templates;
    if (!Array.isArray(templates)) {
      return new Map();
    }
    return new Map(
      templates
        .filter((entry) => isObject(entry) && isNonEmptyString(entry.id))
        .map((entry) => [entry.id.trim(), entry]),
    );
  } catch {
    return new Map();
  }
})();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeOverlay(input) {
  if (!isObject(input) || !isNonEmptyString(input.kind)) {
    return undefined;
  }
  const overlay = {
    kind: input.kind.trim().toLowerCase(),
    expression: isNonEmptyString(input.expression) ? input.expression.trim().toLowerCase() : "emit",
    stacks: toPositiveInt(input.stacks, 1),
    tokenCost: toNonNegativeInt(input.tokenCost, 0),
  };
  return overlay;
}

function normalizeLocalizedTraps(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry) => isObject(entry))
    .map((entry, index) => {
      const affinity = isObject(entry.affinity) ? entry.affinity : {};
      return {
        id: isNonEmptyString(entry.id) ? entry.id.trim() : `trap_${index + 1}`,
        x: toNonNegativeInt(entry.x, 0),
        y: toNonNegativeInt(entry.y, 0),
        blocking: entry.blocking === true,
        tokenCost: toNonNegativeInt(entry.tokenCost, 0),
        affinity: {
          kind: isNonEmptyString(affinity.kind) ? affinity.kind.trim().toLowerCase() : "none",
          expression: isNonEmptyString(affinity.expression) ? affinity.expression.trim().toLowerCase() : "emit",
          stacks: toPositiveInt(affinity.stacks, 1),
        },
      };
    });
}

function normalizeLocalizedTiles(input, defaultTileTokenCost) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry) => isObject(entry))
    .map((entry) => ({
      x: toNonNegativeInt(entry.x, 0),
      y: toNonNegativeInt(entry.y, 0),
      kind: isNonEmptyString(entry.kind) ? entry.kind.trim().toLowerCase() : "floor",
      tokenCost: toNonNegativeInt(entry.tokenCost, defaultTileTokenCost),
    }));
}

function deriveCompositionProfile({ roomWideOverlay, localizedTiles, localizedTraps }) {
  if (roomWideOverlay && localizedTraps.length > 0) {
    return "room_overlay_dominant_with_localized_variation";
  }
  if (roomWideOverlay) {
    return "room_overlay_dominant";
  }
  if (localizedTraps.length > 0) {
    return "neutral_with_localized_traps";
  }
  if (localizedTiles.length > 0) {
    return "mixed_composition";
  }
  return "mixed_composition";
}

function deriveDominantInvestment({ roomWideOverlay, localizedTiles, localizedTraps, tokenSpend }) {
  if (roomWideOverlay && localizedTraps.length > 0) {
    return "room_wide_overlay";
  }
  if (roomWideOverlay) {
    return "room_wide_overlay";
  }
  if (localizedTraps.length > 0) {
    return "localized_traps";
  }
  if (localizedTiles.length > 0) {
    return "localized_tiles";
  }
  if (tokenSpend.defaultTiles > 0) {
    return "default_tiles";
  }
  return "none";
}

function resolveRoomId(room, index) {
  if (isNonEmptyString(room?.id)) return room.id.trim();
  return `R${index + 1}`;
}

function resolveTemplateId(room, composition, index) {
  if (isNonEmptyString(composition?.templateId)) return composition.templateId.trim();
  if (isNonEmptyString(room?.templateId)) return room.templateId.trim();
  return `mixed_room_${index + 1}`;
}

function resolveTemplateInstanceId(room, composition, templateId, index) {
  if (isNonEmptyString(composition?.templateInstanceId)) return composition.templateInstanceId.trim();
  if (isNonEmptyString(room?.templateInstanceId)) return room.templateInstanceId.trim();
  return `${templateId}-${index + 1}`;
}

function resolveBaseComposition(room) {
  if (isObject(room?.mixedRoomComposition)) {
    return room.mixedRoomComposition;
  }
  if (isNonEmptyString(room?.templateId)) {
    return MIXED_ROOM_TEMPLATE_MAP.get(room.templateId.trim()) || null;
  }
  return null;
}

function resolveTokenSpend({
  composition,
  width,
  height,
  defaultTileTokenCost,
  localizedTiles,
  roomWideOverlay,
  localizedTraps,
}) {
  const fallback = {
    defaultTiles: Math.max(0, width) * Math.max(0, height) * defaultTileTokenCost,
    localizedTiles: localizedTiles.reduce((sum, entry) => sum + toNonNegativeInt(entry.tokenCost, 0), 0),
    roomWideOverlay: roomWideOverlay ? toNonNegativeInt(roomWideOverlay.tokenCost, 0) : 0,
    localizedTraps: localizedTraps.reduce((sum, entry) => sum + toNonNegativeInt(entry.tokenCost, 0), 0),
    total: 0,
  };
  fallback.total = fallback.defaultTiles + fallback.localizedTiles + fallback.roomWideOverlay + fallback.localizedTraps;

  const spend = isObject(composition?.tokenSpend) ? composition.tokenSpend : null;
  if (!spend) return fallback;

  const normalized = {
    defaultTiles: toNonNegativeInt(spend.defaultTiles, fallback.defaultTiles),
    localizedTiles: toNonNegativeInt(spend.localizedTiles, fallback.localizedTiles),
    roomWideOverlay: toNonNegativeInt(spend.roomWideOverlay, fallback.roomWideOverlay),
    localizedTraps: toNonNegativeInt(spend.localizedTraps, fallback.localizedTraps),
    total: toNonNegativeInt(spend.total, 0),
  };
  if (normalized.total <= 0) {
    normalized.total = (
      normalized.defaultTiles
      + normalized.localizedTiles
      + normalized.roomWideOverlay
      + normalized.localizedTraps
    );
  }
  return normalized;
}

function collectAffinityKinds({ roomWideOverlay, localizedTraps }) {
  const kinds = new Set();
  if (roomWideOverlay?.kind) {
    kinds.add(roomWideOverlay.kind);
  }
  localizedTraps.forEach((trap) => {
    if (isNonEmptyString(trap?.affinity?.kind)) {
      kinds.add(trap.affinity.kind.trim().toLowerCase());
    }
  });
  return Array.from(kinds.values()).sort((a, b) => a.localeCompare(b));
}

function summarizeRoom(room, index) {
  const composition = resolveBaseComposition(room);
  if (!composition) return null;

  const templateId = resolveTemplateId(room, composition, index);
  const width = toPositiveInt(room?.width ?? composition?.width, 1);
  const height = toPositiveInt(room?.height ?? composition?.height, 1);
  const defaultTileTokenCost = toPositiveInt(composition?.defaultTileTokenCost, 1);
  const roomWideOverlay = normalizeOverlay(composition.roomWideOverlay);
  const localizedTiles = normalizeLocalizedTiles(composition.localizedTiles, defaultTileTokenCost);
  const localizedTraps = normalizeLocalizedTraps(composition.localizedTraps);

  const tokenSpend = resolveTokenSpend({
    composition,
    width,
    height,
    defaultTileTokenCost,
    localizedTiles,
    roomWideOverlay,
    localizedTraps,
  });

  return {
    roomId: resolveRoomId(room, index),
    templateId,
    templateInstanceId: resolveTemplateInstanceId(room, composition, templateId, index),
    compositionProfile: isNonEmptyString(composition.compositionProfile)
      ? composition.compositionProfile.trim()
      : deriveCompositionProfile({ roomWideOverlay, localizedTiles, localizedTraps }),
    dominantInvestment: isNonEmptyString(composition.dominantInvestment)
      ? composition.dominantInvestment.trim()
      : deriveDominantInvestment({ roomWideOverlay, localizedTiles, localizedTraps, tokenSpend }),
    localizedTileCount: localizedTiles.length,
    localizedTrapCount: localizedTraps.length,
    roomWideOverlay,
    affinityKinds: collectAffinityKinds({ roomWideOverlay, localizedTraps }),
    tokenSpend,
  };
}

export function summarizeMixedRoomAssemblies(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return [];
  }
  return rooms
    .map((room, index) => summarizeRoom(room, index))
    .filter((entry) => isObject(entry))
    .map((entry) => ({
      roomId: entry.roomId,
      templateId: entry.templateId,
      templateInstanceId: entry.templateInstanceId,
      compositionProfile: entry.compositionProfile,
      dominantInvestment: entry.dominantInvestment,
      localizedTileCount: entry.localizedTileCount,
      localizedTrapCount: entry.localizedTrapCount,
      roomWideOverlay: entry.roomWideOverlay,
      affinityKinds: Array.isArray(entry.affinityKinds) ? entry.affinityKinds : [],
      tokenSpend: {
        ...DEFAULT_TOKEN_SPEND,
        ...(isObject(entry.tokenSpend) ? entry.tokenSpend : null),
      },
    }));
}

function formatTokenSpend(tokenSpend) {
  const spend = isObject(tokenSpend) ? tokenSpend : DEFAULT_TOKEN_SPEND;
  const normalized = {
    defaultTiles: toNonNegativeInt(spend.defaultTiles, 0),
    localizedTiles: toNonNegativeInt(spend.localizedTiles, 0),
    roomWideOverlay: toNonNegativeInt(spend.roomWideOverlay, 0),
    localizedTraps: toNonNegativeInt(spend.localizedTraps, 0),
    total: toNonNegativeInt(spend.total, 0),
  };
  return `defaultTiles:${normalized.defaultTiles},localizedTiles:${normalized.localizedTiles},roomWideOverlay:${normalized.roomWideOverlay},localizedTraps:${normalized.localizedTraps},total:${normalized.total}`;
}

export function formatMixedRoomAssembliesCliLines(assemblies) {
  if (!Array.isArray(assemblies) || assemblies.length === 0) {
    return ["mixed-room summary: none."];
  }
  const roomLabel = assemblies.length === 1 ? "room" : "rooms";
  const lines = [`mixed-room summary: ${assemblies.length} ${roomLabel}.`];
  assemblies.forEach((entry) => {
    const surfaceAffinities = Array.isArray(entry?.affinityKinds) && entry.affinityKinds.length > 0
      ? entry.affinityKinds.join(",")
      : "none";
    lines.push(
      `mixed-room: template=${entry.templateId} roomId=${entry.roomId} profile=${entry.compositionProfile} dominant=${entry.dominantInvestment} surfaceAffinities=${surfaceAffinities} tokenSpend=${formatTokenSpend(entry.tokenSpend)}`,
    );
  });
  return lines;
}
