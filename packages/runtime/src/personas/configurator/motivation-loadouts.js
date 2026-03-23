import {
  DEFAULT_MOTIVATION_FLAGS,
  DEFAULT_MOTIVATION_PROFILE,
  DEFAULT_MOTIVATION_RULES,
  MOTIVATION_AXIS_VALUES,
  MOTIVATION_COST_DEFAULTS,
  MOTIVATION_FLAG_KEYS,
  MOTIVATION_KIND_IDS,
  MOTIVATION_KINDS,
  MOTIVATION_PROFILE_ITEM_IDS,
  MOTIVATION_REASONING_CLASSES,
  findMotivationRule,
  getMotivationDisplayGroups,
  getMotivationExclusiveGroups,
  getMotivationPatterns,
  resolveMotivationRules,
} from "./motivation-rules.js";

export {
  DEFAULT_MOTIVATION_PROFILE,
  MOTIVATION_AXIS_VALUES,
  MOTIVATION_COST_DEFAULTS,
  MOTIVATION_KIND_IDS,
  MOTIVATION_KINDS,
  MOTIVATION_PROFILE_ITEM_IDS,
  MOTIVATION_REASONING_CLASSES,
} from "./motivation-rules.js";

const LEGACY_MOTIVATION_PROFILE_MAP = Object.freeze(
  DEFAULT_MOTIVATION_RULES.motivations.reduce((acc, entry) => {
    acc[entry.kind] = Object.freeze({ ...entry.profile });
    return acc;
  }, {}),
);

const MOTIVATION_EXCLUSIVE_GROUPS = Object.freeze(
  getMotivationExclusiveGroups(),
);

const MOTIVATION_DISPLAY_GROUPS = Object.freeze(
  getMotivationDisplayGroups(),
);

const MOTIVATION_PATTERNS = Object.freeze(
  getMotivationPatterns(),
);

const MOTIVATION_DEFAULTS = Object.freeze({
  intensity: DEFAULT_MOTIVATION_RULES.globals.defaultIntensity,
  flags: Object.freeze({ ...DEFAULT_MOTIVATION_FLAGS }),
});

const MOTIVATION_EXCLUSIVE_GROUP_BY_KIND = Object.freeze(
  MOTIVATION_EXCLUSIVE_GROUPS.reduce((acc, group) => {
    group.kinds.forEach((kind) => {
      acc[kind] = group;
    });
    return acc;
  }, {}),
);

function addError(errors, field, code) {
  errors.push({ field, code });
}

function normalizeName(value) {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeAxisValue(axis, value, fallback) {
  const allowed = MOTIVATION_AXIS_VALUES[axis] || [];
  const normalized = normalizeName(value);
  if (normalized && allowed.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function mergeMotivationProfile(profile, next) {
  const nextMobility = normalizeAxisValue("mobility", next?.mobility, profile.mobility);
  return {
    mobility: profile.mobility !== DEFAULT_MOTIVATION_PROFILE.mobility && nextMobility === DEFAULT_MOTIVATION_PROFILE.mobility
      ? profile.mobility
      : nextMobility,
    combat: normalizeAxisValue("combat", next?.combat, profile.combat),
    cognition: normalizeAxisValue("cognition", next?.cognition, profile.cognition),
  };
}

function buildExclusiveGroupByKind(rules) {
  return Object.freeze(
    rules.motivations.reduce((acc, entry) => {
      if (!entry.exclusiveGroup) return acc;
      acc[entry.kind] = {
        id: entry.exclusiveGroup,
        kinds: rules.motivations
          .filter((candidate) => candidate.exclusiveGroup === entry.exclusiveGroup)
          .map((candidate) => candidate.kind),
      };
      return acc;
    }, {}),
  );
}

function resolveGroupByKind(rules) {
  if (!rules || rules === DEFAULT_MOTIVATION_RULES) {
    return MOTIVATION_EXCLUSIVE_GROUP_BY_KIND;
  }
  return buildExclusiveGroupByKind(rules);
}

export { LEGACY_MOTIVATION_PROFILE_MAP, MOTIVATION_EXCLUSIVE_GROUPS, MOTIVATION_DISPLAY_GROUPS, MOTIVATION_PATTERNS, MOTIVATION_DEFAULTS };

export function normalizeMotivationKind(raw, { rules } = {}) {
  const normalized = normalizeName(raw);
  if (!normalized) return null;
  const resolvedRules = resolveMotivationRules(rules);
  return resolvedRules.motivations.some((entry) => entry.kind === normalized) ? normalized : null;
}

export function getMotivationExclusiveGroup(kind, { rules } = {}) {
  const normalized = normalizeMotivationKind(kind, { rules });
  if (!normalized) return null;
  return resolveGroupByKind(resolveMotivationRules(rules))[normalized] || null;
}

export function getConflictingMotivationKinds(kind, { rules } = {}) {
  const group = getMotivationExclusiveGroup(kind, { rules });
  if (!group) return [];
  const normalized = normalizeMotivationKind(kind, { rules });
  return group.kinds.filter((entry) => entry !== normalized);
}

export function normalizeMotivationProfile(input, { rules } = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const fallback = DEFAULT_MOTIVATION_PROFILE;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...fallback };
  }
  return {
    mobility: normalizeAxisValue("mobility", input.mobility, fallback.mobility),
    combat: normalizeAxisValue("combat", input.combat, fallback.combat),
    cognition: normalizeAxisValue("cognition", input.cognition, fallback.cognition),
  };
}

export function deriveMotivationProfile(input, fallback = DEFAULT_MOTIVATION_PROFILE, { rules } = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const list = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [input]
      : [];
  let profile = normalizeMotivationProfile(fallback, { rules: resolvedRules });
  list.forEach((entry) => {
    const kind = normalizeMotivationKind(entry, { rules: resolvedRules });
    if (!kind) return;
    const mapped = findMotivationRule(resolvedRules, kind)?.profile;
    if (!mapped) return;
    profile = mergeMotivationProfile(profile, mapped);
  });
  return profile;
}

export function expandMotivationProfile(profile, { includeLegacyCognition = false, rules } = {}) {
  const normalized = normalizeMotivationProfile(profile, { rules });
  const motivations = [];
  if (normalized.mobility !== "stationary" || normalized.combat === "none" || normalized.cognition === "none") {
    motivations.push(normalized.mobility);
  }
  if (normalized.combat !== "none") {
    motivations.push(normalized.combat);
  }
  if (includeLegacyCognition && normalized.cognition !== "none") {
    motivations.push(normalized.cognition);
  }
  return motivations.filter(Boolean);
}

export function deriveReasoningClass(profile, { rules } = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const normalized = normalizeMotivationProfile(profile, { rules: resolvedRules });
  return resolvedRules.globals.reasoningClasses[normalized.cognition] || "instinctual";
}

export function buildMotivationCostItems(profile, { rules } = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const normalized = normalizeMotivationProfile(profile, { rules: resolvedRules });
  return Object.entries(normalized).map(([axis, value]) => ({
    axis,
    value,
    id: MOTIVATION_PROFILE_ITEM_IDS[axis][value],
    defaultCostTokens: resolvedRules.globals.profileCosts[axis][value] || 0,
  }));
}

export function normalizeMotivationKindList(input, { fieldBase = "motivations", fallback = "", allowEmpty = false, rules } = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const errors = [];
  const warnings = [];
  const groupByKind = resolveGroupByKind(resolvedRules);
  if (input === undefined) {
    const fallbackKind = normalizeMotivationKind(fallback, { rules: resolvedRules });
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      value: allowEmpty || !fallbackKind ? [] : [fallbackKind],
    };
  }

  const list = Array.isArray(input) ? input : typeof input === "string" ? [input] : null;
  if (!list) {
    addError(errors, fieldBase, "invalid_list");
    return { ok: false, errors, warnings, value: [] };
  }

  const value = [];
  const seen = new Set();
  const selectedGroupKinds = new Map();
  list.forEach((entry, index) => {
    const kind = normalizeMotivationKind(entry, { rules: resolvedRules });
    if (!kind) {
      addError(errors, `${fieldBase}[${index}]`, "invalid_kind");
      return;
    }
    if (seen.has(kind)) return;
    const group = groupByKind[kind];
    if (group) {
      const selectedKind = selectedGroupKinds.get(group.id);
      if (selectedKind && selectedKind !== kind) {
        addError(errors, `${fieldBase}[${index}]`, "conflicting_kind");
        return;
      }
      selectedGroupKinds.set(group.id, kind);
    }
    seen.add(kind);
    value.push(kind);
  });

  if (value.length === 0 && !allowEmpty) {
    const fallbackKind = normalizeMotivationKind(fallback, { rules: resolvedRules });
    if (fallbackKind) value.push(fallbackKind);
  }

  return { ok: errors.length === 0, errors, warnings, value };
}

function normalizeFlags(flags, base, errors, rules) {
  if (flags === undefined) {
    return { ...DEFAULT_MOTIVATION_FLAGS };
  }
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    addError(errors, base, "invalid_flags");
    return { ...DEFAULT_MOTIVATION_FLAGS };
  }
  const normalized = { ...DEFAULT_MOTIVATION_FLAGS };
  Object.entries(flags).forEach(([key, value]) => {
    if (!MOTIVATION_FLAG_KEYS.includes(key)) {
      addError(errors, `${base}.${key}`, "unknown_flag");
      return;
    }
    if (typeof value !== "boolean") {
      addError(errors, `${base}.${key}`, "invalid_flag_value");
      return;
    }
    normalized[key] = value;
  });
  return normalized;
}

function normalizePattern(rule, pattern, base, errors) {
  const allowedPatterns = Array.isArray(rule?.patterns) ? rule.patterns : [];
  const fallback = rule?.defaultPattern || allowedPatterns[0];
  if (allowedPatterns.length === 0) {
    return undefined;
  }
  if (pattern === undefined) {
    return fallback;
  }
  if (typeof pattern !== "string") {
    addError(errors, `${base}.pattern`, "invalid_pattern");
    return fallback;
  }
  const normalized = pattern.trim().toLowerCase();
  if (!allowedPatterns.includes(normalized)) {
    addError(errors, `${base}.pattern`, "unknown_pattern");
    return fallback;
  }
  return normalized;
}

export function normalizeMotivation(entry, base, errors = [], { rules } = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const entryBase = base || "motivations";
  const defaultIntensity = resolvedRules.globals.defaultIntensity;
  const maxIntensity = resolvedRules.globals.maxIntensity;

  if (typeof entry === "string" || typeof entry === "number") {
    const kind = normalizeMotivationKind(String(entry), { rules: resolvedRules });
    if (!kind) {
      addError(errors, entryBase, "invalid_kind");
      return null;
    }
    const rule = findMotivationRule(resolvedRules, kind);
    const motivationProfile = deriveMotivationProfile([kind], DEFAULT_MOTIVATION_PROFILE, { rules: resolvedRules });
    const reasoningClass = deriveReasoningClass(motivationProfile, { rules: resolvedRules });
    return {
      kind,
      intensity: defaultIntensity,
      pattern: normalizePattern(rule, undefined, entryBase, errors),
      flags: rule?.defaultFlags ? { ...rule.defaultFlags } : { ...DEFAULT_MOTIVATION_FLAGS },
      motivationProfile,
      reasoningClass,
      complexityClass: reasoningClass,
      defaultDesignCostTokens: rule?.defaultDesignCostTokens || 0,
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    addError(errors, entryBase, "invalid_motivation");
    return null;
  }

  const kind = normalizeMotivationKind(entry.kind || entry.name || entry.type, { rules: resolvedRules });
  if (!kind) {
    addError(errors, `${entryBase}.kind`, "invalid_kind");
    return null;
  }
  const rule = findMotivationRule(resolvedRules, kind);

  const intensityRaw = entry.intensity ?? entry.stacks ?? defaultIntensity;
  const intensity = Number.isInteger(intensityRaw) ? intensityRaw : defaultIntensity;
  if (!Number.isInteger(intensityRaw) || intensityRaw < 1) {
    addError(errors, `${entryBase}.intensity`, "invalid_intensity");
  }
  if (intensity > maxIntensity) {
    addError(errors, `${entryBase}.intensity`, "intensity_clamped");
  }
  const clampedIntensity = Math.min(Math.max(intensity, 1), maxIntensity);

  const pattern = normalizePattern(rule, entry.pattern, entryBase, errors);
  const flags = normalizeFlags(entry.flags, `${entryBase}.flags`, errors, resolvedRules);
  const priority = entry.priority === undefined ? undefined : entry.priority;
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0)) {
    addError(errors, `${entryBase}.priority`, "invalid_priority");
  }

  const motivationProfile = mergeMotivationProfile(
    deriveMotivationProfile([kind], DEFAULT_MOTIVATION_PROFILE, { rules: resolvedRules }),
    normalizeMotivationProfile(entry.motivationProfile, { rules: resolvedRules }),
  );
  const reasoningClass = deriveReasoningClass(motivationProfile, { rules: resolvedRules });
  return {
    kind,
    intensity: clampedIntensity,
    pattern,
    flags,
    priority: Number.isInteger(priority) && priority >= 0 ? priority : undefined,
    motivationProfile,
    reasoningClass,
    complexityClass: reasoningClass,
    defaultDesignCostTokens: rule?.defaultDesignCostTokens || 0,
  };
}

export function normalizeMotivations(input, fieldBase = "motivations", { rules } = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const errors = [];
  const warnings = [];
  const groupByKind = resolveGroupByKind(resolvedRules);
  if (input === undefined) {
    return { ok: true, errors, warnings, value: [] };
  }

  const list = Array.isArray(input) ? input : typeof input === "string" ? [input] : null;
  if (!list) {
    addError(errors, fieldBase, "invalid_list");
    return { ok: false, errors, warnings, value: [] };
  }

  const value = [];
  const selectedGroupKinds = new Map();
  list.forEach((entry, index) => {
    const normalized = normalizeMotivation(entry, `${fieldBase}[${index}]`, errors, { rules: resolvedRules });
    if (normalized) {
      const group = groupByKind[normalized.kind];
      if (group) {
        const selectedKind = selectedGroupKinds.get(group.id);
        if (selectedKind && selectedKind !== normalized.kind) {
          addError(errors, `${fieldBase}[${index}]`, "conflicting_kind");
          return;
        }
        selectedGroupKinds.set(group.id, normalized.kind);
      }
      value.push(normalized);
    }
  });

  return { ok: errors.length === 0, errors, warnings, value };
}
