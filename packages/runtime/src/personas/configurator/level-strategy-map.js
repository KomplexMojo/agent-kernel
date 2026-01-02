const STRATEGY_PRESETS = Object.freeze({
  "rooms:rectangular": {
    shape: { profile: "rectangular" },
  },
  "rooms:sparse": {
    shape: { profile: "sparse_islands", density: 0.25 },
  },
  "rooms:dense": {
    shape: { profile: "sparse_islands", density: 0.55 },
  },
  "rooms:clustered": {
    shape: { profile: "clustered_islands", clusterSize: 8 },
  },
});

const STRATEGY_PRIORITY = Object.freeze([
  "rooms:clustered",
  "rooms:dense",
  "rooms:sparse",
  "rooms:rectangular",
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
  const hasProfile = typeof nextShape.profile === "string";

  if (!hasProfile && overrideShape.profile) {
    nextShape.profile = overrideShape.profile;
  }

  if (!nextShape.profile || !overrideShape.profile || nextShape.profile !== overrideShape.profile) {
    return nextShape;
  }

  if (nextShape.profile === "sparse_islands" && nextShape.density === undefined && overrideShape.density !== undefined) {
    nextShape.density = overrideShape.density;
  }
  if (nextShape.profile === "clustered_islands" && nextShape.clusterSize === undefined && overrideShape.clusterSize !== undefined) {
    nextShape.clusterSize = overrideShape.clusterSize;
  }

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
