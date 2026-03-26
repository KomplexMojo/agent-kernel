export const MOTIVATION_FAMILIES = Object.freeze({
  mobility: Object.freeze(["random", "stationary", "exploring", "patrolling"]),
  posture: Object.freeze(["attacking", "defending", "stealthy", "friendly"]),
  cognition: Object.freeze(["reflexive", "goal_oriented", "strategy_focused"]),
});

export const MOTIVATION_KINDS = Object.freeze([
  ...MOTIVATION_FAMILIES.mobility,
  ...MOTIVATION_FAMILIES.posture,
  ...MOTIVATION_FAMILIES.cognition,
]);
export const MOTIVATION_EXCLUSIVE_GROUPS = Object.freeze([
  Object.freeze({ id: "mobility", kinds: MOTIVATION_FAMILIES.mobility }),
  Object.freeze({ id: "posture", kinds: MOTIVATION_FAMILIES.posture }),
  Object.freeze({ id: "cognition", kinds: MOTIVATION_FAMILIES.cognition }),
]);
export const MOTIVATION_DISPLAY_GROUPS = Object.freeze([
  Object.freeze({ id: "mobility", kinds: MOTIVATION_FAMILIES.mobility }),
  Object.freeze({ id: "posture", kinds: MOTIVATION_FAMILIES.posture }),
  Object.freeze({ id: "cognition", kinds: MOTIVATION_FAMILIES.cognition }),
]);
export const MOTIVATION_PATTERNS = Object.freeze({
  patrolling: Object.freeze(["loop", "ping_pong", "random_walk"]),
  attacking: Object.freeze(["melee", "ranged", "mixed"]),
  defending: Object.freeze(["hold_point", "bodyguard"]),
});

export const MOTIVATION_GOAL_TYPES = Object.freeze({
  defending: Object.freeze(["defend_point", "defend_zone", "defend_actor"]),
  attacking: Object.freeze(["attack_target", "attack_zone"]),
  patrolling: Object.freeze(["patrol_route", "patrol_zone"]),
  goal_oriented: Object.freeze(["reach_point", "reach_zone", "acquire_item", "defend_point", "defend_zone", "defend_actor", "attack_target", "attack_zone"]),
  strategy_focused: Object.freeze(["reach_point", "reach_zone", "acquire_item", "defend_point", "defend_zone", "defend_actor", "attack_target", "attack_zone", "patrol_route", "patrol_zone"]),
});

export const MOTIVATION_DEFAULTS = Object.freeze({
  intensity: 1,
  flags: Object.freeze({
    canMove: true,
    prefersStealth: false,
    prefersCover: false,
    aggroRangeBoost: false,
  }),
});

export const MOTIVATION_KIND_IDS = Object.freeze({
  random: "motivation_random",
  stationary: "motivation_stationary",
  exploring: "motivation_exploring",
  patrolling: "motivation_patrolling",
  attacking: "motivation_attacking",
  defending: "motivation_defending",
  stealthy: "motivation_stealthy",
  friendly: "motivation_friendly",
  reflexive: "motivation_reflexive",
  goal_oriented: "motivation_goal_oriented",
  strategy_focused: "motivation_strategy_focused",
});

const MOTIVATION_FLAG_KEYS = Object.freeze(["canMove", "prefersStealth", "prefersCover", "aggroRangeBoost"]);
const MOTIVATION_MAX_INTENSITY = 10;
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

export function normalizeMotivationKind(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (MOTIVATION_KINDS.includes(normalized)) return normalized;
  return null;
}

export function getMotivationExclusiveGroup(kind) {
  const normalized = normalizeMotivationKind(kind);
  if (!normalized) return null;
  return MOTIVATION_EXCLUSIVE_GROUP_BY_KIND[normalized] || null;
}

export function getConflictingMotivationKinds(kind) {
  const normalized = normalizeMotivationKind(kind);
  if (!normalized) return [];
  const group = MOTIVATION_EXCLUSIVE_GROUP_BY_KIND[normalized];
  if (!group) return [];
  return group.kinds.filter((entry) => entry !== normalized);
}

export function normalizeMotivationKindList(input, { fieldBase = "motivations", fallback = "", allowEmpty = false } = {}) {
  const errors = [];
  const warnings = [];
  if (input === undefined) {
    const fallbackKind = normalizeMotivationKind(fallback);
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
    const kind = normalizeMotivationKind(entry);
    if (!kind) {
      addError(errors, `${fieldBase}[${index}]`, "invalid_kind");
      return;
    }
    if (seen.has(kind)) return;
    const group = MOTIVATION_EXCLUSIVE_GROUP_BY_KIND[kind];
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
    const fallbackKind = normalizeMotivationKind(fallback);
    if (fallbackKind) value.push(fallbackKind);
  }

  return { ok: errors.length === 0, errors, warnings, value };
}

function normalizeFlags(flags, base, errors) {
  if (flags === undefined) {
    return MOTIVATION_DEFAULTS.flags;
  }
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    addError(errors, base, "invalid_flags");
    return MOTIVATION_DEFAULTS.flags;
  }
  const normalized = { ...MOTIVATION_DEFAULTS.flags };
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

function normalizePattern(kind, pattern, base, errors) {
  const allowedPatterns = MOTIVATION_PATTERNS[kind];
  if (!allowedPatterns) {
    return undefined;
  }
  if (pattern === undefined) {
    return allowedPatterns[0];
  }
  if (typeof pattern !== "string") {
    addError(errors, `${base}.pattern`, "invalid_pattern");
    return allowedPatterns[0];
  }
  const normalized = pattern.trim().toLowerCase();
  if (!allowedPatterns.includes(normalized)) {
    addError(errors, `${base}.pattern`, "unknown_pattern");
    return allowedPatterns[0];
  }
  return normalized;
}

const GOAL_PARAM_KEYS = Object.freeze(["x", "y", "zone", "targetId", "route", "itemId"]);

function normalizeGoalParams(params, base, errors) {
  if (params === undefined || params === null) return undefined;
  if (typeof params !== "object" || Array.isArray(params)) {
    addError(errors, `${base}.params`, "invalid_goal_params");
    return undefined;
  }
  const normalized = {};
  let hasKeys = false;
  for (const [key, value] of Object.entries(params)) {
    if (!GOAL_PARAM_KEYS.includes(key)) {
      addError(errors, `${base}.params.${key}`, "unknown_goal_param");
      continue;
    }
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number" && !Array.isArray(value)) {
      addError(errors, `${base}.params.${key}`, "invalid_goal_param_value");
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.filter(
        (v) => typeof v === "string" || typeof v === "number",
      );
    } else {
      normalized[key] = value;
    }
    hasKeys = true;
  }
  return hasKeys ? Object.freeze(normalized) : undefined;
}

function normalizeGoal(kind, goal, base, errors) {
  const allowedTypes = MOTIVATION_GOAL_TYPES[kind];
  if (!allowedTypes) {
    if (goal !== undefined && goal !== null) {
      addError(errors, `${base}.goal`, "goal_not_supported");
    }
    return undefined;
  }
  if (goal === undefined || goal === null) return undefined;
  if (typeof goal !== "object" || Array.isArray(goal)) {
    addError(errors, `${base}.goal`, "invalid_goal");
    return undefined;
  }
  const type = typeof goal.type === "string" ? goal.type.trim().toLowerCase().replace(/[\s-]+/g, "_") : null;
  if (!type) {
    addError(errors, `${base}.goal.type`, "missing_goal_type");
    return undefined;
  }
  if (!allowedTypes.includes(type)) {
    addError(errors, `${base}.goal.type`, "unknown_goal_type");
    return undefined;
  }
  const objective = typeof goal.objective === "string" && goal.objective.trim()
    ? goal.objective.trim()
    : undefined;
  const params = normalizeGoalParams(goal.params, `${base}.goal`, errors);
  const result = { type };
  if (objective) result.objective = objective;
  if (params) result.params = params;
  return Object.freeze(result);
}

export function normalizeMotivation(entry, base, errors = []) {
  const entryBase = base || "motivations";
  if (typeof entry === "string" || typeof entry === "number") {
    const kind = normalizeMotivationKind(String(entry));
    if (!kind) {
      addError(errors, entryBase, "invalid_kind");
      return null;
    }
    return {
      kind,
      intensity: MOTIVATION_DEFAULTS.intensity,
      pattern: normalizePattern(kind, undefined, entryBase, errors),
      flags: MOTIVATION_DEFAULTS.flags,
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    addError(errors, entryBase, "invalid_motivation");
    return null;
  }

  const kind = normalizeMotivationKind(entry.kind || entry.name || entry.type);
  if (!kind) {
    addError(errors, `${entryBase}.kind`, "invalid_kind");
    return null;
  }

  const intensityRaw = entry.intensity ?? entry.stacks ?? MOTIVATION_DEFAULTS.intensity;
  const intensity = Number.isInteger(intensityRaw) ? intensityRaw : MOTIVATION_DEFAULTS.intensity;
  if (!Number.isInteger(intensityRaw) || intensityRaw < 1) {
    addError(errors, `${entryBase}.intensity`, "invalid_intensity");
  }
  if (intensity > MOTIVATION_MAX_INTENSITY) {
    addError(errors, `${entryBase}.intensity`, "intensity_clamped");
  }
  const clampedIntensity = Math.min(Math.max(intensity, 1), MOTIVATION_MAX_INTENSITY);

  const pattern = normalizePattern(kind, entry.pattern, entryBase, errors);
  const flags = normalizeFlags(entry.flags, `${entryBase}.flags`, errors);
  const goal = normalizeGoal(kind, entry.goal, entryBase, errors);
  const priority = entry.priority === undefined ? undefined : entry.priority;
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0)) {
    addError(errors, `${entryBase}.priority`, "invalid_priority");
  }

  const result = {
    kind,
    intensity: clampedIntensity,
    pattern,
    flags,
    priority: Number.isInteger(priority) && priority >= 0 ? priority : undefined,
  };
  if (goal) result.goal = goal;
  return result;
}

export function normalizeMotivations(input, fieldBase = "motivations") {
  const errors = [];
  const warnings = [];
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
    const normalized = normalizeMotivation(entry, `${fieldBase}[${index}]`, errors);
    if (normalized) {
      const group = MOTIVATION_EXCLUSIVE_GROUP_BY_KIND[normalized.kind];
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
