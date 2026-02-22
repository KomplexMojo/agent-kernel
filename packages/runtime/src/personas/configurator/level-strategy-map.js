const STRATEGY_PRESETS = Object.freeze({
  "rooms:connected": {
    shape: { roomCount: 4, roomMinSize: 3, roomMaxSize: 9, corridorWidth: 1 },
  },
  "rooms:compact": {
    shape: { roomCount: 6, roomMinSize: 3, roomMaxSize: 6, corridorWidth: 1 },
  },
  "rooms:expansive": {
    shape: { roomCount: 3, roomMinSize: 6, roomMaxSize: 14, corridorWidth: 2 },
  },
});

const STRATEGY_PRIORITY = Object.freeze([
  "rooms:expansive",
  "rooms:compact",
  "rooms:connected",
]);

function normalizeTag(tag) {
  if (typeof tag !== "string") return null;
  const trimmed = tag.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith("rooms:") ? trimmed : `rooms:${trimmed}`;
}

function collectTags(plan = {}) {
  const tags = [];
  const themeTags = plan?.theme?.tags;
  if (Array.isArray(themeTags)) {
    for (const tag of themeTags) {
      const normalized = normalizeTag(tag);
      if (normalized) tags.push(normalized);
    }
  }
  const directiveTags = plan?.directives?.strategyTags;
  if (Array.isArray(directiveTags)) {
    for (const tag of directiveTags) {
      const normalized = normalizeTag(tag);
      if (normalized) tags.push(normalized);
    }
  }
  return tags;
}

function resolveStrategyTag(plan = {}) {
  const directive = plan?.directives?.roomStrategy ?? plan?.directives?.levelStrategy;
  const directiveTag = normalizeTag(directive);
  if (directiveTag && STRATEGY_PRESETS[directiveTag]) {
    return { tag: directiveTag, source: "directive" };
  }
  const tags = collectTags(plan);
  for (const candidate of STRATEGY_PRIORITY) {
    if (tags.includes(candidate)) {
      return { tag: candidate, source: "tag" };
    }
  }
  return { tag: null, source: null };
}

function applyShapeOverrides(baseShape, overrides) {
  if (!overrides?.shape) return baseShape;
  const nextShape = baseShape ? { ...baseShape } : {};
  const overrideShape = overrides.shape;
  ["roomCount", "roomMinSize", "roomMaxSize", "corridorWidth"].forEach((field) => {
    if (nextShape[field] === undefined && overrideShape[field] !== undefined) {
      nextShape[field] = overrideShape[field];
    }
  });
  return nextShape;
}

function applyOverrides(levelGenInput, overrides) {
  if (!overrides) return { ...levelGenInput };
  const next = { ...levelGenInput };
  if (levelGenInput?.shape || overrides.shape) {
    next.shape = applyShapeOverrides(levelGenInput?.shape, overrides);
  }
  return next;
}

export function applyLevelStrategy(levelGenInput = {}, plan = {}) {
  const { tag, source } = resolveStrategyTag(plan);
  const overrides = tag ? STRATEGY_PRESETS[tag] : null;
  const value = applyOverrides(levelGenInput, overrides);
  return { value, applied: tag, source };
}

export { STRATEGY_PRESETS, STRATEGY_PRIORITY };
