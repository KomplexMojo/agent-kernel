import {
  GAME_MOTIVATION_KIND_IDS,
  GAME_MOTIVATION_KINDS,
} from "../../contracts/game-elements.js";

export const BEHAVIOR_COMPLEXITY_CLASSES = Object.freeze(["instinctual", "tactical", "strategic"]);

export const MOTIVATION_AXIS_VALUES = Object.freeze({
  mobility: Object.freeze(["stationary", "exploring", "patrolling"]),
  combat: Object.freeze(["none", "attacking", "defending"]),
  cognition: Object.freeze(["none", "reflexive", "goal_oriented", "strategy_focused"]),
});

export const DEFAULT_MOTIVATION_PROFILE = Object.freeze({
  mobility: "stationary",
  combat: "none",
  cognition: "none",
});

export const DEFAULT_MOTIVATION_FLAGS = Object.freeze({
  canMove: true,
  prefersStealth: false,
  prefersCover: false,
  aggroRangeBoost: false,
});

export const MOTIVATION_KIND_IDS = GAME_MOTIVATION_KIND_IDS;

export const MOTIVATION_PROFILE_ITEM_IDS = Object.freeze({
  mobility: Object.freeze({
    stationary: "mobility_stationary",
    exploring: "mobility_exploring",
    patrolling: "mobility_patrolling",
  }),
  combat: Object.freeze({
    none: "combat_none",
    attacking: "combat_attacking",
    defending: "combat_defending",
  }),
  cognition: Object.freeze({
    none: "cognition_none",
    reflexive: "cognition_reflexive",
    goal_oriented: "cognition_goal_oriented",
    strategy_focused: "cognition_strategy_focused",
  }),
});

export const MOTIVATION_FLAG_KEYS = Object.freeze(Object.keys(DEFAULT_MOTIVATION_FLAGS));
export const MOTIVATION_KINDS = GAME_MOTIVATION_KINDS;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function addError(errors, field, code) {
  errors.push({ field, code });
}

function normalizeAxisValue(axis, value, fallback, fieldBase, errors) {
  const allowed = MOTIVATION_AXIS_VALUES[axis] || [];
  if (value !== undefined && typeof value !== "string") {
    addError(errors, fieldBase, "invalid_axis_value");
    return fallback;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (allowed.includes(normalized)) return normalized;
    addError(errors, fieldBase, "invalid_axis_value");
  }
  return fallback;
}

function normalizeProfile(profile, fieldBase, errors) {
  const value = isPlainObject(profile) ? profile : {};
  return {
    mobility: normalizeAxisValue("mobility", value.mobility, DEFAULT_MOTIVATION_PROFILE.mobility, `${fieldBase}.mobility`, errors),
    combat: normalizeAxisValue("combat", value.combat, DEFAULT_MOTIVATION_PROFILE.combat, `${fieldBase}.combat`, errors),
    cognition: normalizeAxisValue("cognition", value.cognition, DEFAULT_MOTIVATION_PROFILE.cognition, `${fieldBase}.cognition`, errors),
  };
}

function normalizeFlags(flags, fieldBase, errors) {
  if (flags === undefined) {
    return { ...DEFAULT_MOTIVATION_FLAGS };
  }
  if (!isPlainObject(flags)) {
    addError(errors, fieldBase, "invalid_flags");
    return { ...DEFAULT_MOTIVATION_FLAGS };
  }
  const normalized = { ...DEFAULT_MOTIVATION_FLAGS };
  Object.entries(flags).forEach(([key, value]) => {
    if (!MOTIVATION_FLAG_KEYS.includes(key)) {
      addError(errors, `${fieldBase}.${key}`, "unknown_flag");
      return;
    }
    if (typeof value !== "boolean") {
      addError(errors, `${fieldBase}.${key}`, "invalid_flag_value");
      return;
    }
    normalized[key] = value;
  });
  return normalized;
}

function normalizePatternList(patterns, fieldBase, errors) {
  if (patterns === undefined) return [];
  if (!Array.isArray(patterns)) {
    addError(errors, fieldBase, "invalid_list");
    return [];
  }
  const seen = new Set();
  const value = [];
  patterns.forEach((pattern, index) => {
    if (!isNonEmptyString(pattern)) {
      addError(errors, `${fieldBase}[${index}]`, "invalid_pattern");
      return;
    }
    const normalized = pattern.trim().toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    value.push(normalized);
  });
  return value;
}

function normalizeProfileCosts(profileCosts, fieldBase, errors) {
  if (!isPlainObject(profileCosts)) {
    addError(errors, fieldBase, "invalid_profile_costs");
    return null;
  }
  const output = {};
  Object.entries(MOTIVATION_AXIS_VALUES).forEach(([axis, allowedValues]) => {
    const axisBase = `${fieldBase}.${axis}`;
    const rawAxis = isPlainObject(profileCosts[axis]) ? profileCosts[axis] : {};
    output[axis] = {};
    allowedValues.forEach((value) => {
      const rawCost = rawAxis[value];
      if (!isNonNegativeInteger(rawCost)) {
        addError(errors, `${axisBase}.${value}`, "invalid_non_negative_int");
        output[axis][value] = 0;
        return;
      }
      output[axis][value] = rawCost;
    });
  });
  return output;
}

function normalizeReasoningClasses(reasoningClasses, fieldBase, errors) {
  if (!isPlainObject(reasoningClasses)) {
    addError(errors, fieldBase, "invalid_reasoning_classes");
    return null;
  }
  const output = {};
  MOTIVATION_AXIS_VALUES.cognition.forEach((value) => {
    const complexityClass = reasoningClasses[value];
    if (!BEHAVIOR_COMPLEXITY_CLASSES.includes(complexityClass)) {
      addError(errors, `${fieldBase}.${value}`, "invalid_complexity_class");
      output[value] = "instinctual";
      return;
    }
    output[value] = complexityClass;
  });
  return output;
}

function normalizeGlobals(globals, errors) {
  if (!isPlainObject(globals)) {
    addError(errors, "globals", "invalid_globals");
    return null;
  }
  const defaultIntensity = globals.defaultIntensity;
  const maxIntensity = globals.maxIntensity;
  if (!Number.isInteger(defaultIntensity) || defaultIntensity < 1) {
    addError(errors, "globals.defaultIntensity", "invalid_positive_int");
  }
  if (!Number.isInteger(maxIntensity) || maxIntensity < 1) {
    addError(errors, "globals.maxIntensity", "invalid_positive_int");
  }
  if (Number.isInteger(defaultIntensity) && Number.isInteger(maxIntensity) && defaultIntensity > maxIntensity) {
    addError(errors, "globals.maxIntensity", "less_than_default_intensity");
  }
  return {
    defaultIntensity: Number.isInteger(defaultIntensity) && defaultIntensity > 0 ? defaultIntensity : 1,
    maxIntensity: Number.isInteger(maxIntensity) && maxIntensity > 0 ? maxIntensity : 10,
    reasoningClasses: normalizeReasoningClasses(globals.reasoningClasses, "globals.reasoningClasses", errors),
    profileCosts: normalizeProfileCosts(globals.profileCosts, "globals.profileCosts", errors),
  };
}

function normalizeMotivationRule(entry, fieldBase, errors) {
  if (!isPlainObject(entry)) {
    addError(errors, fieldBase, "invalid_motivation_rule");
    return null;
  }
  const kind = typeof entry.kind === "string" ? entry.kind.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (!MOTIVATION_KINDS.includes(kind)) {
    addError(errors, `${fieldBase}.kind`, "invalid_kind");
  }
  const patterns = normalizePatternList(entry.patterns, `${fieldBase}.patterns`, errors);
  const defaultPattern = entry.defaultPattern === undefined
    ? (patterns[0] || undefined)
    : isNonEmptyString(entry.defaultPattern)
      ? entry.defaultPattern.trim().toLowerCase()
      : undefined;
  if (defaultPattern !== undefined && patterns.length > 0 && !patterns.includes(defaultPattern)) {
    addError(errors, `${fieldBase}.defaultPattern`, "unknown_default_pattern");
  }
  if (entry.defaultDesignCostTokens !== undefined && !isNonNegativeInteger(entry.defaultDesignCostTokens)) {
    addError(errors, `${fieldBase}.defaultDesignCostTokens`, "invalid_non_negative_int");
  }
  return {
    kind,
    profile: normalizeProfile(entry.profile, `${fieldBase}.profile`, errors),
    exclusiveGroup: isNonEmptyString(entry.exclusiveGroup) ? entry.exclusiveGroup.trim() : undefined,
    displayGroup: isNonEmptyString(entry.displayGroup) ? entry.displayGroup.trim() : undefined,
    patterns,
    defaultPattern,
    defaultFlags: normalizeFlags(entry.defaultFlags, `${fieldBase}.defaultFlags`, errors),
    defaultDesignCostTokens: isNonNegativeInteger(entry.defaultDesignCostTokens) ? entry.defaultDesignCostTokens : 0,
  };
}

export function normalizeMotivationRulesArtifact(input = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    addError(errors, "artifact", "invalid_artifact");
    return { ok: false, errors, warnings, value: null };
  }
  if (input.schema !== "agent-kernel/MotivationRulesArtifact") {
    addError(errors, "schema", "invalid_schema");
  }
  if (input.schemaVersion !== 1) {
    addError(errors, "schemaVersion", "invalid_schema_version");
  }
  if (!isPlainObject(input.meta) || !isNonEmptyString(input.meta.id)) {
    addError(errors, "meta", "invalid_meta");
  }
  if (!isNonEmptyString(input.balanceVersion)) {
    addError(errors, "balanceVersion", "invalid_balance_version");
  }
  if (!isNonEmptyString(input.contentHash)) {
    addError(errors, "contentHash", "invalid_content_hash");
  }
  if (!isNonEmptyString(input.rulesetName)) {
    addError(errors, "rulesetName", "invalid_ruleset_name");
  }
  if (!Array.isArray(input.motivations)) {
    addError(errors, "motivations", "invalid_list");
    return { ok: false, errors, warnings, value: null };
  }

  const globals = normalizeGlobals(input.globals, errors);
  const motivations = input.motivations
    .map((entry, index) => normalizeMotivationRule(entry, `motivations[${index}]`, errors))
    .filter(Boolean);
  const seenKinds = new Set();
  motivations.forEach((entry, index) => {
    if (seenKinds.has(entry.kind)) {
      addError(errors, `motivations[${index}].kind`, "duplicate_kind");
    }
    seenKinds.add(entry.kind);
  });
  MOTIVATION_KINDS.forEach((kind) => {
    if (!seenKinds.has(kind)) {
      addError(errors, "motivations", `missing_motivation_${kind}`);
    }
  });

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    value: ok
      ? {
        schema: input.schema,
        schemaVersion: input.schemaVersion,
        meta: cloneJson(input.meta),
        balanceVersion: input.balanceVersion,
        contentHash: input.contentHash,
        rulesetName: input.rulesetName,
        globals,
        motivations,
      }
      : null,
  };
}

export function findMotivationRule(rules, kind) {
  const normalizedRules = resolveMotivationRules(rules);
  const normalizedKind = typeof kind === "string" ? kind.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (!normalizedKind) return null;
  return normalizedRules.motivations.find((entry) => entry.kind === normalizedKind) || null;
}

export function resolveMotivationRules(rules) {
  if (!rules) return DEFAULT_MOTIVATION_RULES;
  const normalized = normalizeMotivationRulesArtifact(rules);
  return normalized.ok ? normalized.value : DEFAULT_MOTIVATION_RULES;
}

export const DEFAULT_MOTIVATION_RULES_ARTIFACT = Object.freeze({
  schema: "agent-kernel/MotivationRulesArtifact",
  schemaVersion: 1,
  meta: Object.freeze({
    id: "motivation_rules_basic",
    runId: "run_motivation_rules_basic",
    createdAt: "2026-03-22T00:00:00.000Z",
    producedBy: "runtime-defaults",
  }),
  balanceVersion: "2026.03.22",
  contentHash: "sha256:motivation-rules-basic",
  rulesetName: "Basic Motivation Rules",
  globals: Object.freeze({
    defaultIntensity: 1,
    maxIntensity: 10,
    reasoningClasses: Object.freeze({
      none: "instinctual",
      reflexive: "instinctual",
      goal_oriented: "tactical",
      strategy_focused: "strategic",
    }),
    profileCosts: Object.freeze({
      mobility: Object.freeze({
        stationary: 0,
        exploring: 1,
        patrolling: 2,
      }),
      combat: Object.freeze({
        none: 0,
        attacking: 5,
        defending: 4,
      }),
      cognition: Object.freeze({
        none: 0,
        reflexive: 1,
        goal_oriented: 5,
        strategy_focused: 20,
      }),
    }),
  }),
  motivations: Object.freeze([
    Object.freeze({
      kind: "random",
      profile: Object.freeze({ mobility: "exploring", combat: "none", cognition: "reflexive" }),
      exclusiveGroup: "planning",
      displayGroup: "planning",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "stationary",
      profile: Object.freeze({ mobility: "stationary", combat: "none", cognition: "none" }),
      exclusiveGroup: "mobility",
      displayGroup: "mobility",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "exploring",
      profile: Object.freeze({ mobility: "exploring", combat: "none", cognition: "reflexive" }),
      exclusiveGroup: "mobility",
      displayGroup: "mobility",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "attacking",
      profile: Object.freeze({ mobility: "exploring", combat: "attacking", cognition: "goal_oriented" }),
      exclusiveGroup: "combat",
      displayGroup: "combat",
      patterns: Object.freeze(["melee", "ranged", "mixed"]),
      defaultPattern: "melee",
      defaultFlags: Object.freeze({ canMove: true, prefersStealth: false, prefersCover: false, aggroRangeBoost: true }),
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "defending",
      profile: Object.freeze({ mobility: "stationary", combat: "defending", cognition: "goal_oriented" }),
      exclusiveGroup: "combat",
      displayGroup: "combat",
      patterns: Object.freeze(["hold_point", "bodyguard"]),
      defaultPattern: "hold_point",
      defaultFlags: Object.freeze({ canMove: true, prefersStealth: false, prefersCover: true, aggroRangeBoost: false }),
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "stealthy",
      profile: Object.freeze({ mobility: "exploring", combat: "none", cognition: "goal_oriented" }),
      exclusiveGroup: "posture",
      displayGroup: "posture",
      defaultFlags: Object.freeze({ canMove: true, prefersStealth: true, prefersCover: false, aggroRangeBoost: false }),
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "friendly",
      profile: Object.freeze({ mobility: "exploring", combat: "none", cognition: "reflexive" }),
      exclusiveGroup: "posture",
      displayGroup: "posture",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "patrolling",
      profile: Object.freeze({ mobility: "patrolling", combat: "none", cognition: "reflexive" }),
      exclusiveGroup: "mobility",
      displayGroup: "mobility_route",
      patterns: Object.freeze(["loop", "ping_pong", "random_walk"]),
      defaultPattern: "loop",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 0,
    }),
    Object.freeze({
      kind: "reflexive",
      profile: Object.freeze({ mobility: "stationary", combat: "none", cognition: "reflexive" }),
      exclusiveGroup: "response",
      displayGroup: "response",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 1,
    }),
    Object.freeze({
      kind: "goal_oriented",
      profile: Object.freeze({ mobility: "stationary", combat: "none", cognition: "goal_oriented" }),
      exclusiveGroup: "response",
      displayGroup: "response",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 5,
    }),
    Object.freeze({
      kind: "strategy_focused",
      profile: Object.freeze({ mobility: "stationary", combat: "none", cognition: "strategy_focused" }),
      exclusiveGroup: "planning",
      displayGroup: "planning",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 20,
    }),
    Object.freeze({
      kind: "user_controlled",
      profile: Object.freeze({ mobility: "stationary", combat: "none", cognition: "none" }),
      exclusiveGroup: "control",
      displayGroup: "control",
      defaultFlags: DEFAULT_MOTIVATION_FLAGS,
      defaultDesignCostTokens: 0,
    }),
  ]),
});

const DEFAULT_MOTIVATION_RULES_RESULT = normalizeMotivationRulesArtifact(DEFAULT_MOTIVATION_RULES_ARTIFACT);

if (!DEFAULT_MOTIVATION_RULES_RESULT.ok) {
  throw new Error(
    `Default motivation rules invalid: ${DEFAULT_MOTIVATION_RULES_RESULT.errors.map((entry) => `${entry.field}:${entry.code}`).join(", ")}`,
  );
}

export const DEFAULT_MOTIVATION_RULES = Object.freeze(DEFAULT_MOTIVATION_RULES_RESULT.value);
export const MOTIVATION_REASONING_CLASSES = Object.freeze({ ...DEFAULT_MOTIVATION_RULES.globals.reasoningClasses });
export const MOTIVATION_COST_DEFAULTS = Object.freeze(
  Object.entries(MOTIVATION_PROFILE_ITEM_IDS).reduce((acc, [axis, values]) => {
    Object.entries(values).forEach(([value, id]) => {
      acc[id] = DEFAULT_MOTIVATION_RULES.globals.profileCosts[axis][value] || 0;
    });
    return acc;
  }, {}),
);

function buildRuleGroups(rules, fieldName) {
  return Object.freeze(
    Array.from(
      rules.motivations.reduce((groups, entry) => {
        if (!entry[fieldName]) return groups;
        if (!groups.has(entry[fieldName])) {
          groups.set(entry[fieldName], []);
        }
        groups.get(entry[fieldName]).push(entry.kind);
        return groups;
      }, new Map()).entries(),
    ).map(([id, kinds]) => Object.freeze({ id, kinds: Object.freeze(kinds.slice()) })),
  );
}

function buildPatternMap(rules) {
  return Object.freeze(
    rules.motivations.reduce((acc, entry) => {
      if (Array.isArray(entry.patterns) && entry.patterns.length > 0) {
        acc[entry.kind] = Object.freeze(entry.patterns.slice());
      }
      return acc;
    }, {}),
  );
}

export function getMotivationExclusiveGroups({ rules } = {}) {
  return buildRuleGroups(resolveMotivationRules(rules), "exclusiveGroup");
}

export function getMotivationDisplayGroups({ rules } = {}) {
  return buildRuleGroups(resolveMotivationRules(rules), "displayGroup");
}

export function getMotivationPatterns({ rules } = {}) {
  return buildPatternMap(resolveMotivationRules(rules));
}
