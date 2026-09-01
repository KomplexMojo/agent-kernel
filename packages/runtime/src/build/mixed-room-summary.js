// CR.7 / WP-5 — affinity rules are Configurator law, taken from the persona's public surface.
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";

const { resolveAffinityRules } = createConfiguratorPersona({ clock: UNUSED_CLOCK });

const DESIGN_TOKEN_COMPONENTS = Object.freeze([
  "defaultTiles",
  "localizedTiles",
  "roomWideOverlay",
  "localizedHazards",
]);

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
  };
  return overlay;
}

function normalizeLocalizedHazards(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry) => isObject(entry))
    .map((entry, index) => {
      const affinity = isObject(entry.affinity) ? entry.affinity : {};
      const rawKind = isNonEmptyString(entry.affinity)
        ? entry.affinity
        : isNonEmptyString(entry.kind)
          ? entry.kind
          : isNonEmptyString(affinity.kind)
            ? affinity.kind
            : isNonEmptyString(entry.affinities?.[0]?.kind)
              ? entry.affinities[0].kind
              : "";
      return {
        id: isNonEmptyString(entry.id) ? entry.id.trim() : `hazard_${index + 1}`,
        x: toNonNegativeInt(entry.x, 0),
        y: toNonNegativeInt(entry.y, 0),
        blocking: entry.blocking === true,
        affinity: {
          kind: isNonEmptyString(rawKind) ? rawKind.trim().toLowerCase() : "none",
          expression: isNonEmptyString(affinity.expression) ? affinity.expression.trim().toLowerCase() : "emit",
          stacks: toPositiveInt(affinity.stacks, 1),
        },
      };
  });
}

function normalizeLocalizedTiles(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry) => isObject(entry))
    .map((entry) => ({
      x: toNonNegativeInt(entry.x, 0),
      y: toNonNegativeInt(entry.y, 0),
      kind: isNonEmptyString(entry.kind) ? entry.kind.trim().toLowerCase() : "floor",
    }));
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
  if (
    Array.isArray(room?.hazards)
    || Array.isArray(room?.localizedHazards)
    || Array.isArray(room?.localizedHazards)
  ) {
    return {};
  }
  if (isNonEmptyString(room?.templateId)) {
    return MIXED_ROOM_TEMPLATE_MAP.get(room.templateId.trim()) || null;
  }
  return null;
}

function unavailableDesignTokenSpend(reason) {
  return { status: "unavailable", unit: "design_tokens", reason };
}

function resolveDesignTokenSpend(composition) {
  const spend = isObject(composition?.designTokenSpend) ? composition.designTokenSpend : null;
  if (!spend) return unavailableDesignTokenSpend("allocator_summary_required");
  if (spend.status === "unavailable"
    && spend.unit === "design_tokens"
    && spend.producedBy === "allocator"
    && isNonEmptyString(spend.reason)) {
    return unavailableDesignTokenSpend(spend.reason.trim());
  }
  const components = isObject(spend.components) ? spend.components : null;
  const exactComponentKeys = components
    && Object.keys(components).sort().join("|") === [...DESIGN_TOKEN_COMPONENTS].sort().join("|");
  const validComponents = exactComponentKeys && DESIGN_TOKEN_COMPONENTS.every((key) => (
    Number.isInteger(components[key]) && components[key] >= 0
  ));
  const componentTotal = validComponents
    ? DESIGN_TOKEN_COMPONENTS.reduce((sum, key) => sum + components[key], 0)
    : -1;
  if (spend.status !== "available"
    || spend.unit !== "design_tokens"
    || spend.producedBy !== "allocator"
    || !validComponents
    || !Number.isInteger(spend.total)
    || spend.total < 0
    || spend.total !== componentTotal) {
    return unavailableDesignTokenSpend("allocator_summary_invalid");
  }
  return {
    status: "available",
    unit: "design_tokens",
    producedBy: spend.producedBy,
    components: Object.fromEntries(DESIGN_TOKEN_COMPONENTS.map((key) => [key, components[key]])),
    total: spend.total,
  };
}

function collectAffinityKinds({ roomWideOverlay, localizedHazards }) {
  const kinds = new Set();
  if (roomWideOverlay?.kind) {
    kinds.add(roomWideOverlay.kind);
  }
  localizedHazards.forEach((hazard) => {
    if (isNonEmptyString(hazard?.affinity?.kind)) {
      kinds.add(hazard.affinity.kind.trim().toLowerCase());
    }
  });
  return Array.from(kinds.values()).sort((a, b) => a.localeCompare(b));
}

function collectHazardsForRoom(room, composition, localizedHazards) {
  const roomLocalizedHazards = normalizeLocalizedHazards(room?.localizedHazards);
  return [
    ...normalizeLocalizedHazards(composition?.localizedHazards),
    ...normalizeLocalizedHazards(composition?.hazards),
    ...normalizeLocalizedHazards(room?.localizedHazards),
    ...normalizeLocalizedHazards(room?.hazards),
    ...[...localizedHazards, ...roomLocalizedHazards].map((hazard) => ({
      id: hazard.id,
      affinity: {
        kind: isNonEmptyString(hazard?.affinity?.kind) ? hazard.affinity.kind.trim().toLowerCase() : "",
      },
    })),
  ];
}

function affinityDisplayName(kind) {
  return kind === "corrode" ? "corrosion" : kind;
}

function deriveHazardAffinityRoomLabel(hazards) {
  if (!Array.isArray(hazards) || hazards.length === 0) {
    return { label: "unlabeled room", kinds: [] };
  }
  const kinds = hazards
    .map((hazard) => (isNonEmptyString(hazard?.affinity?.kind) ? hazard.affinity.kind.trim().toLowerCase() : ""))
    .filter((kind) => kind.length > 0);
  const uniqueKinds = Array.from(new Set(kinds)).sort((a, b) => a.localeCompare(b));
  if (uniqueKinds.length === 1 && kinds.length === hazards.length) {
    return { label: `${affinityDisplayName(uniqueKinds[0])} affinity room`, kinds: uniqueKinds };
  }
  return { label: "mixed affinity room", kinds: uniqueKinds };
}

function summarizeRoom(room, index) {
  const composition = resolveBaseComposition(room);
  if (!composition) return null;

  const templateId = resolveTemplateId(room, composition, index);
  const roomWideOverlay = normalizeOverlay(composition.roomWideOverlay);
  const localizedTiles = normalizeLocalizedTiles(composition.localizedTiles);
  const compositionHazards = normalizeLocalizedHazards(composition.localizedHazards);
  const localizedHazards = collectHazardsForRoom(room, composition, compositionHazards);
  const hazardAffinitySummary = deriveHazardAffinityRoomLabel(localizedHazards);

  const designTokenSpend = resolveDesignTokenSpend(composition);

  return {
    roomId: resolveRoomId(room, index),
    templateId,
    templateInstanceId: resolveTemplateInstanceId(room, composition, templateId, index),
    compositionProfile: isNonEmptyString(composition.compositionProfile)
      ? composition.compositionProfile.trim()
      : "unavailable",
    dominantInvestment: isNonEmptyString(composition.dominantInvestment)
      ? composition.dominantInvestment.trim()
      : "unavailable",
    localizedTileCount: localizedTiles.length,
    localizedHazardCount: localizedHazards.length,
    roomWideOverlay,
    affinityKinds: collectAffinityKinds({ roomWideOverlay, localizedHazards }),
    hazardAffinityKinds: hazardAffinitySummary.kinds,
    affinityRoomLabel: hazardAffinitySummary.label,
    designTokenSpend,
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
      localizedHazardCount: entry.localizedHazardCount,
      roomWideOverlay: entry.roomWideOverlay,
      affinityKinds: Array.isArray(entry.affinityKinds) ? entry.affinityKinds : [],
      hazardAffinityKinds: Array.isArray(entry.hazardAffinityKinds) ? entry.hazardAffinityKinds : [],
      affinityRoomLabel: isNonEmptyString(entry.affinityRoomLabel) ? entry.affinityRoomLabel : "unlabeled room",
      designTokenSpend: entry.designTokenSpend,
    }));
}

function formatDesignTokenSpend(designTokenSpend) {
  if (designTokenSpend?.status !== "available") return "unavailable";
  const components = designTokenSpend.components;
  return `${DESIGN_TOKEN_COMPONENTS.map((key) => `${key}:${components[key]}`).join(",")},total:${designTokenSpend.total}`;
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
    const roomLabel = isNonEmptyString(entry?.affinityRoomLabel)
      ? entry.affinityRoomLabel
      : "unlabeled room";
    lines.push(
      `mixed-room: template=${entry.templateId} roomId=${entry.roomId} label="${roomLabel}" profile=${entry.compositionProfile} dominant=${entry.dominantInvestment} surfaceAffinities=${surfaceAffinities} designTokenSpend=${formatDesignTokenSpend(entry.designTokenSpend)} designTokenUnit=design_tokens designTokenSource=${entry.designTokenSpend?.producedBy || "unavailable"}`,
    );
  });
  return lines;
}
