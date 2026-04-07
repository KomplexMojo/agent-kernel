import {
  AFFINITY_KINDS,
  AFFINITY_OPPOSITES,
  AFFINITY_EXPRESSION_SET,
  DEFAULT_AFFINITY_EXPRESSION,
} from "../../contracts/domain-constants.js";

const EXPRESSION_PROFILES = Object.freeze({
  push: Object.freeze({ channel: "spatial", polarity: "outward" }),
  pull: Object.freeze({ channel: "spatial", polarity: "inward" }),
  emit: Object.freeze({ channel: "field", polarity: "outward" }),
  draw: Object.freeze({ channel: "field", polarity: "inward" }),
});

function normalizeAffinityExpression(rawExpression, fallback = DEFAULT_AFFINITY_EXPRESSION) {
  if (AFFINITY_EXPRESSION_SET.has(rawExpression)) return rawExpression;
  return fallback;
}

function resolveAffinityExpressionProfile(rawExpression, fallback = DEFAULT_AFFINITY_EXPRESSION) {
  const expression = normalizeAffinityExpression(rawExpression, fallback);
  return EXPRESSION_PROFILES[expression] || EXPRESSION_PROFILES[fallback];
}

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
  return [];
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

