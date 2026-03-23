import {
  AFFINITY_KINDS,
  AFFINITY_OPPOSITES,
  DEFAULT_AFFINITY_EXPRESSION,
  normalizeAffinityExpression,
  resolveAffinityExpressionProfile,
} from "../../contracts/domain-constants.js";

function toPositiveInt(value, fallback = 1) {
  const normalized = Number.isFinite(value) ? Math.floor(value) : NaN;
  if (!Number.isFinite(normalized) || normalized < 1) {
    return fallback;
  }
  return normalized;
}

function normalizeAffinitySourceEntry(entry = {}, source) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (!AFFINITY_KINDS.includes(entry.kind)) return null;
  const expression = normalizeAffinityExpression(entry.expression, DEFAULT_AFFINITY_EXPRESSION);
  const stacks = toPositiveInt(entry.stacks, 1);
  const profile = resolveAffinityExpressionProfile(expression, DEFAULT_AFFINITY_EXPRESSION);
  return {
    source,
    sourceId: source.id,
    kind: entry.kind,
    expression,
    stacks,
    channel: profile?.channel,
    polarity: profile?.polarity,
  };
}

function collectRoomPressureSources(rooms = []) {
  const sources = [];
  if (!Array.isArray(rooms)) return sources;
  rooms.forEach((room, index) => {
    if (!room || typeof room !== "object") return;
    const source = { kind: "room", id: typeof room.id === "string" ? room.id : `room_${index + 1}` };
    const affinityList = Array.isArray(room.affinities)
      ? room.affinities
      : (room.affinity && AFFINITY_KINDS.includes(room.affinity))
          ? [{ kind: room.affinity, expression: DEFAULT_AFFINITY_EXPRESSION, stacks: 1 }]
          : [];
    affinityList.forEach((entry) => {
      const normalized = normalizeAffinitySourceEntry(entry, source);
      if (normalized) sources.push(normalized);
    });
  });
  return sources;
}

function collectTrapPressureSources(traps = []) {
  const sources = [];
  if (!Array.isArray(traps)) return sources;
  traps.forEach((trap, index) => {
    if (!trap || typeof trap !== "object") return;
    const source = {
      kind: "trap",
      id: Number.isFinite(trap.x) && Number.isFinite(trap.y) ? `${trap.x},${trap.y}` : `trap_${index + 1}`,
    };
    const normalized = normalizeAffinitySourceEntry(trap.affinity, source);
    if (normalized) sources.push(normalized);
  });
  return sources;
}

function buildZeroByKind() {
  return Object.fromEntries(AFFINITY_KINDS.map((kind) => [kind, 0]));
}

function addBasePressure(baseByKind, sourceEntries = []) {
  const next = { ...baseByKind };
  sourceEntries.forEach((entry) => {
    next[entry.kind] = (next[entry.kind] || 0) + entry.stacks;
  });
  return next;
}

function resolveNetPressure(baseByKind = {}) {
  const netByKind = buildZeroByKind();
  const cancellations = [];
  const visited = new Set();

  AFFINITY_KINDS.forEach((kind) => {
    if (visited.has(kind)) return;
    const opposite = AFFINITY_OPPOSITES[kind];
    if (!opposite || !AFFINITY_KINDS.includes(opposite)) {
      netByKind[kind] = baseByKind[kind] || 0;
      visited.add(kind);
      return;
    }
    if (visited.has(opposite)) return;
    const sourceStacks = baseByKind[kind] || 0;
    const targetStacks = baseByKind[opposite] || 0;
    const canceled = Math.min(sourceStacks, targetStacks);
    netByKind[kind] = sourceStacks - canceled;
    netByKind[opposite] = targetStacks - canceled;
    cancellations.push({
      kind,
      opposite,
      sourceStacks,
      oppositeStacks: targetStacks,
      canceled,
    });
    visited.add(kind);
    visited.add(opposite);
  });

  return { netByKind, cancellations };
}

export function buildAmbientAffinityPressure({
  rooms = [],
  traps = [],
} = {}) {
  const roomSources = collectRoomPressureSources(rooms);
  const trapSources = collectTrapPressureSources(traps);
  const sourceEntries = roomSources.concat(trapSources);
  const baseByKind = addBasePressure(buildZeroByKind(), sourceEntries);
  const { netByKind, cancellations } = resolveNetPressure(baseByKind);
  return {
    sources: sourceEntries,
    baseByKind,
    netByKind,
    cancellations,
  };
}

