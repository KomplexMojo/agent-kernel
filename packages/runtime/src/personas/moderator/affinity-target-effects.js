import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_TARGET_TYPES,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_AFFINITY_TARGET_TYPE,
  DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION,
} from "../../contracts/domain-constants.js";

const DEFAULT_ENVIRONMENT_THRESHOLD = 3;
const DEFAULT_MAX_ACTIONS = 8;
const CARDINAL_NEIGHBORS = Object.freeze([
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]);

const VITAL_TARGET_BY_AFFINITY = Object.freeze({
  fire: "health",
  water: "health",
  life: "health",
  decay: "health",
  earth: "stamina",
  wind: "stamina",
  light: "mana",
  dark: "mana",
  corrode: "durability",
  fortify: "durability",
});

function toPositiveInt(value, fallback = 1) {
  const normalized = Number.isFinite(value) ? Math.floor(value) : NaN;
  if (!Number.isFinite(normalized) || normalized < 1) {
    return fallback;
  }
  return normalized;
}

function toNonNegativeInt(value, fallback = 0) {
  const normalized = Number.isFinite(value) ? Math.floor(value) : NaN;
  if (!Number.isFinite(normalized) || normalized < 0) {
    return fallback;
  }
  return normalized;
}

function normalizeExpression(rawExpression, fallback = DEFAULT_AFFINITY_EXPRESSION) {
  if (AFFINITY_EXPRESSIONS.includes(rawExpression)) {
    return rawExpression;
  }
  return fallback;
}

export function normalizeAffinityTargetType(rawTargetType, expression = DEFAULT_AFFINITY_EXPRESSION) {
  if (AFFINITY_TARGET_TYPES.includes(rawTargetType)) {
    return rawTargetType;
  }
  return DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION[expression] || DEFAULT_AFFINITY_TARGET_TYPE;
}

function normalizeAffinityEntry(entry = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  if (!AFFINITY_KINDS.includes(entry.kind)) {
    return null;
  }
  const expression = normalizeExpression(entry.expression);
  return {
    kind: entry.kind,
    expression,
    stacks: toPositiveInt(entry.stacks, 1),
    targetType: normalizeAffinityTargetType(entry.targetType, expression),
  };
}

function buildVitalEffect({
  sourceType,
  kind,
  expression,
  stacks,
  targetType,
  sourceId = null,
} = {}) {
  const targetVital = VITAL_TARGET_BY_AFFINITY[kind];
  if (!targetVital) {
    return null;
  }
  return {
    id: `${kind}:${expression}:${targetType}:vital`,
    category: "vital",
    operation: "apply_vital_affinity",
    sourceType,
    sourceId,
    kind,
    expression,
    stacks,
    targetType,
    targetVital,
    potency: stacks,
  };
}

function buildEnvironmentEffects({
  sourceType,
  kind,
  expression,
  stacks,
  targetType,
  manaReserve,
  sourceId = null,
  environmentThreshold = DEFAULT_ENVIRONMENT_THRESHOLD,
} = {}) {
  const effects = [];
  if (stacks >= environmentThreshold) {
    if (kind === "earth") {
      const operation = expression === "pull" ? "raise_barrier" : "destroy_barrier";
      const environmentTarget = operation === "raise_barrier" ? "floor" : "barrier";
      effects.push({
        id: `${kind}:${expression}:${targetType}:${operation}`,
        category: "environment",
        operation,
        sourceType,
        sourceId,
        kind,
        expression,
        stacks,
        targetType: environmentTarget,
        minimumStacks: environmentThreshold,
      });
    }
    if (kind === "water" || kind === "wind") {
      effects.push({
        id: `${kind}:${expression}:${targetType}:destroy_barrier`,
        category: "environment",
        operation: "destroy_barrier",
        sourceType,
        sourceId,
        kind,
        expression,
        stacks,
        targetType: "barrier",
        minimumStacks: environmentThreshold,
      });
    }
  }

  if (targetType === "floor" && manaReserve > 0) {
    effects.push({
      id: `${kind}:${expression}:${targetType}:arm_static_trap`,
      category: "environment",
      operation: "arm_static_trap",
      sourceType,
      sourceId,
      kind,
      expression,
      stacks,
      targetType: "floor",
      manaReserve,
    });
  }
  return effects;
}

export function resolveAffinityTargetEffectsForEntry(entry, {
  sourceType = "actor",
  sourceId = null,
  manaReserve = 0,
  environmentThreshold = DEFAULT_ENVIRONMENT_THRESHOLD,
} = {}) {
  const normalized = normalizeAffinityEntry(entry);
  if (!normalized) return [];
  const stacks = toPositiveInt(normalized.stacks, 1);
  const normalizedManaReserve = toNonNegativeInt(manaReserve, 0);
  const effects = [];
  const vitalEffect = buildVitalEffect({
    sourceType,
    sourceId,
    kind: normalized.kind,
    expression: normalized.expression,
    stacks,
    targetType: normalized.targetType,
  });
  if (vitalEffect) effects.push(vitalEffect);
  effects.push(...buildEnvironmentEffects({
    sourceType,
    sourceId,
    kind: normalized.kind,
    expression: normalized.expression,
    stacks,
    targetType: normalized.targetType,
    manaReserve: normalizedManaReserve,
    environmentThreshold,
  }));
  return effects;
}

export function resolveAffinityTargetEffectsForList(affinities = [], {
  sourceType = "actor",
  sourceId = null,
  manaReserve = 0,
  environmentThreshold = DEFAULT_ENVIRONMENT_THRESHOLD,
} = {}) {
  if (!Array.isArray(affinities) || affinities.length === 0) {
    return [];
  }
  const effects = [];
  affinities.forEach((entry) => {
    effects.push(...resolveAffinityTargetEffectsForEntry(entry, {
      sourceType,
      sourceId,
      manaReserve,
      environmentThreshold,
    }));
  });
  effects.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return effects;
}

function parseAffinityCombosFromStacks(entry = {}) {
  const combos = [];
  const fromTargets = entry?.affinityTargets;
  if (fromTargets && typeof fromTargets === "object" && !Array.isArray(fromTargets)) {
    Object.entries(fromTargets).forEach(([rawKey, rawStacks]) => {
      const key = String(rawKey || "");
      const [kind, expression, targetType] = key.split(":");
      if (!AFFINITY_KINDS.includes(kind)) return;
      const normalizedExpression = normalizeExpression(expression);
      combos.push({
        kind,
        expression: normalizedExpression,
        targetType: normalizeAffinityTargetType(targetType, normalizedExpression),
        stacks: toPositiveInt(rawStacks, 1),
      });
    });
    return combos;
  }
  const fromStacks = entry?.affinityStacks;
  if (!fromStacks || typeof fromStacks !== "object" || Array.isArray(fromStacks)) {
    return combos;
  }
  Object.entries(fromStacks).forEach(([rawKey, rawStacks]) => {
    const key = String(rawKey || "");
    const [kind, expression] = key.split(":");
    if (!AFFINITY_KINDS.includes(kind)) return;
    const normalizedExpression = normalizeExpression(expression);
    combos.push({
      kind,
      expression: normalizedExpression,
      targetType: normalizeAffinityTargetType(undefined, normalizedExpression),
      stacks: toPositiveInt(rawStacks, 1),
    });
  });
  return combos;
}

function tileKindAt(observation, x, y) {
  if (!observation?.tiles?.kinds) return null;
  const row = observation.tiles.kinds[y];
  if (!Array.isArray(row)) return null;
  const value = row[x];
  return Number.isFinite(value) ? value : null;
}

function isBarrierTile(observation, x, y) {
  return tileKindAt(observation, x, y) === 1;
}

function isFloorTile(observation, x, y) {
  return tileKindAt(observation, x, y) === 0;
}

function findAdjacent(position, predicate) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  for (const delta of CARDINAL_NEIGHBORS) {
    const x = position.x + delta.x;
    const y = position.y + delta.y;
    if (predicate(x, y)) {
      return { x, y };
    }
  }
  return null;
}

function resolveActorPosition(observation, actorId) {
  if (!Array.isArray(observation?.actors)) return null;
  const match = observation.actors.find((entry) => String(entry?.id || "") === String(actorId || ""));
  return match?.position || null;
}

function buildActionFromEffect({ effect, actorId, position, observation, tick }) {
  if (!effect || !position) return null;
  if (effect.operation === "destroy_barrier") {
    const target = findAdjacent(position, (x, y) => isBarrierTile(observation, x, y));
    if (!target) return null;
    return {
      schema: "agent-kernel/Action",
      schemaVersion: 1,
      actorId,
      tick,
      kind: "destroy_barrier",
      params: { ...target },
    };
  }
  if (effect.operation === "raise_barrier") {
    const target = findAdjacent(position, (x, y) => isFloorTile(observation, x, y));
    if (!target) return null;
    return {
      schema: "agent-kernel/Action",
      schemaVersion: 1,
      actorId,
      tick,
      kind: "raise_barrier",
      params: { ...target },
    };
  }
  if (effect.operation === "arm_static_trap") {
    const target = isFloorTile(observation, position.x, position.y)
      ? { x: position.x, y: position.y }
      : findAdjacent(position, (x, y) => isFloorTile(observation, x, y));
    if (!target) return null;
    return {
      schema: "agent-kernel/Action",
      schemaVersion: 1,
      actorId,
      tick,
      kind: "arm_static_trap",
      params: {
        ...target,
        kind: effect.kind,
        expression: effect.expression,
        stacks: effect.stacks,
        manaReserve: toPositiveInt(effect.manaReserve, 1),
      },
    };
  }
  return null;
}

function resolveEffectsForActorEntry(entry = {}) {
  if (Array.isArray(entry?.resolvedEffects) && entry.resolvedEffects.length > 0) {
    return entry.resolvedEffects.slice();
  }
  const affinities = parseAffinityCombosFromStacks(entry);
  const manaReserve = toNonNegativeInt(entry?.vitals?.mana?.current, 0);
  return resolveAffinityTargetEffectsForList(affinities, {
    sourceType: "actor",
    sourceId: entry?.actorId || null,
    manaReserve,
  });
}

export function planModeratorAffinityActions({
  observation = null,
  affinityEffects = null,
  tick = 0,
  maxActions = DEFAULT_MAX_ACTIONS,
} = {}) {
  if (!observation || !affinityEffects || !Array.isArray(affinityEffects.actors)) {
    return [];
  }
  const limit = toPositiveInt(maxActions, DEFAULT_MAX_ACTIONS);
  const planned = [];
  const seen = new Set();
  const actors = affinityEffects.actors
    .filter((entry) => entry && typeof entry === "object")
    .slice()
    .sort((a, b) => String(a.actorId || "").localeCompare(String(b.actorId || "")));

  for (const actorEntry of actors) {
    if (planned.length >= limit) break;
    const actorId = String(actorEntry.actorId || "");
    if (!actorId) continue;
    const position = resolveActorPosition(observation, actorId);
    if (!position) continue;
    const effects = resolveEffectsForActorEntry(actorEntry)
      .filter((effect) => effect?.category === "environment")
      .slice()
      .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
    for (const effect of effects) {
      if (planned.length >= limit) break;
      const action = buildActionFromEffect({ effect, actorId, position, observation, tick });
      if (!action) continue;
      const key = `${action.kind}:${action.params?.x}:${action.params?.y}:${action.params?.kind || ""}:${action.params?.expression || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      planned.push(action);
    }
  }

  return planned;
}

export const AFFINITY_VITAL_TARGETS = VITAL_TARGET_BY_AFFINITY;
export const MODERATOR_ENVIRONMENT_THRESHOLD = DEFAULT_ENVIRONMENT_THRESHOLD;
