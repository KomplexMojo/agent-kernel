const BASE_MOTIVATION_KINDS = Object.freeze(["random", "stationary", "exploring", "attacking", "defending", "patrolling"]);
const LEGACY_MOTIVATION_KINDS = Object.freeze(["reflexive", "goal_oriented", "strategy_focused"]);

export const MOTIVATION_KINDS = Object.freeze([...BASE_MOTIVATION_KINDS, ...LEGACY_MOTIVATION_KINDS]);
export const MOTIVATION_PATTERNS = Object.freeze({
  patrolling: Object.freeze(["loop", "ping_pong", "random_walk"]),
  attacking: Object.freeze(["melee", "ranged", "mixed"]),
  defending: Object.freeze(["hold_point", "bodyguard"]),
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
  attacking: "motivation_attacking",
  defending: "motivation_defending",
  patrolling: "motivation_patrolling",
  reflexive: "motivation_reflexive",
  goal_oriented: "motivation_goal_oriented",
  strategy_focused: "motivation_strategy_focused",
});

const MOTIVATION_FLAG_KEYS = Object.freeze(["canMove", "prefersStealth", "prefersCover", "aggroRangeBoost"]);
const MOTIVATION_MAX_INTENSITY = 10;

function addError(errors, field, code) {
  errors.push({ field, code });
}

function normalizeKind(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (MOTIVATION_KINDS.includes(normalized)) return normalized;
  return null;
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

export function normalizeMotivation(entry, base, errors = []) {
  const entryBase = base || "motivations";
  if (typeof entry === "string" || typeof entry === "number") {
    const kind = normalizeKind(String(entry));
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

  const kind = normalizeKind(entry.kind || entry.name || entry.type);
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
  const priority = entry.priority === undefined ? undefined : entry.priority;
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0)) {
    addError(errors, `${entryBase}.priority`, "invalid_priority");
  }

  return {
    kind,
    intensity: clampedIntensity,
    pattern,
    flags,
    priority: Number.isInteger(priority) && priority >= 0 ? priority : undefined,
  };
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
  list.forEach((entry, index) => {
    const normalized = normalizeMotivation(entry, `${fieldBase}[${index}]`, errors);
    if (normalized) {
      value.push(normalized);
    }
  });

  return { ok: errors.length === 0, errors, warnings, value };
}
