import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";

const REGEN_KEYS = Object.freeze(VITAL_KEYS.filter((key) => key !== "durability"));

const COST_DEFAULTS = Object.freeze({
  tokensPerVital: 1,
  tokensPerRegen: 2,
  affinityBaseCost: 4,
  affinityStackExponent: 2,
});

const FIXED_POSITION_WORLD_ACTOR_KINDS = Object.freeze(["floor", "barrier", "trap", "tile"]);
const WORLD_ACTOR_COST_DEFAULTS = Object.freeze({
  neutralTokenCost: 1,
  manaReserveTokenDivisor: 5,
  allowZeroReserveAffinityState: true,
  regenOptional: true,
});
const DEFAULT_TRAP_ARCHETYPE_RULES = Object.freeze({
  roomBounded: true,
  attackingOnly: true,
  maxAffinityCount: 1,
  maxExpressionCount: 1,
  stacksAllowed: true,
  manaReserveRequired: true,
  manaRegenOptional: true,
  allowedExpressions: Object.freeze([...AFFINITY_EXPRESSIONS]),
});

const COST_FORMULAS = Object.freeze({
  vitalCost: "vitalCost = (health + mana + stamina + durability) * tokensPerVital",
  regenCost: "regenCost = (healthRegen + manaRegen + staminaRegen) * tokensPerRegen",
  affinityCost: "affinityCost = affinityBaseCost * stacks ^ affinityStackExponent",
  totalCost: "totalCost = vitalCost + regenCost + affinityCost",
  fixedPositionWorldActorCost:
    "fixedPositionCost = tokenCost + vitalCost + regenCost + affinityCost + ceil(manaReserve / manaReserveTokenDivisor)",
  notes: [
    "Affinities require mana > 0 and manaRegen > 0.",
    "Durability regen is unsupported.",
    "Fixed-position world actors can preserve affinity state at zero mana when policy allows.",
  ],
});

function addError(errors, field, code, detail) {
  const entry = { field, code };
  if (detail !== undefined) entry.detail = detail;
  errors.push(entry);
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readNonNegativeInt(value, field, errors) {
  if (!Number.isInteger(value) || value < 0) {
    addError(errors, field, "invalid_non_negative_int");
    return 0;
  }
  return value;
}

function readPositiveInt(value, field, errors) {
  if (!Number.isInteger(value) || value <= 0) {
    addError(errors, field, "invalid_positive_int");
    return 0;
  }
  return value;
}

function asNonNegativeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

function ensureUniqueStrings(list) {
  const seen = new Set();
  const out = [];
  list.forEach((entry) => {
    const value = String(entry || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

export function normalizeVitals(vitals, errors, fieldBase = "vitals") {
  if (vitals === undefined) return {};
  if (!isPlainObject(vitals)) {
    addError(errors, fieldBase, "invalid_object");
    return {};
  }
  const result = {};
  VITAL_KEYS.forEach((key) => {
    if (vitals[key] !== undefined) {
      result[key] = readNonNegativeInt(vitals[key], `${fieldBase}.${key}`, errors);
    }
  });
  return result;
}

export function normalizeRegen(regen, errors, fieldBase = "regen") {
  if (regen === undefined) return {};
  if (!isPlainObject(regen)) {
    addError(errors, fieldBase, "invalid_object");
    return {};
  }
  if (regen.durability !== undefined) {
    addError(errors, `${fieldBase}.durability`, "unsupported_regen");
  }
  const result = {};
  REGEN_KEYS.forEach((key) => {
    if (regen[key] !== undefined) {
      result[key] = readNonNegativeInt(regen[key], `${fieldBase}.${key}`, errors);
    }
  });
  return result;
}

export function normalizeAffinityList(affinities, errors, fieldBase = "affinities") {
  if (!Array.isArray(affinities) || affinities.length === 0) {
    addError(errors, fieldBase, "missing_affinity");
    return [];
  }
  return affinities.reduce((list, entry, index) => {
    const base = `${fieldBase}[${index}]`;
    if (isNonEmptyString(entry)) {
      list.push({ kind: entry.trim(), stacks: 1 });
      return list;
    }
    if (!isPlainObject(entry)) {
      addError(errors, base, "invalid_affinity");
      return list;
    }
    if (!isNonEmptyString(entry.kind)) {
      addError(errors, `${base}.kind`, "invalid_affinity");
      return list;
    }
    const stacks = entry.stacks === undefined ? 1 : entry.stacks;
    if (!Number.isInteger(stacks) || stacks < 1) {
      addError(errors, `${base}.stacks`, "invalid_stacks");
      return list;
    }
    list.push({ kind: entry.kind.trim(), stacks });
    return list;
  }, []);
}

export function calculateVitalCost({
  vitals,
  tokensPerVital = COST_DEFAULTS.tokensPerVital,
} = {}) {
  const errors = [];
  if (!Number.isInteger(tokensPerVital) || tokensPerVital <= 0) {
    addError(errors, "tokensPerVital", "invalid_positive_int");
  }
  const normalizedVitals = normalizeVitals(vitals, errors);
  const points = VITAL_KEYS.reduce((sum, key) => sum + (normalizedVitals[key] || 0), 0);
  if (errors.length > 0) {
    return { ok: false, errors, cost: 0, points, vitals: normalizedVitals };
  }
  return {
    ok: true,
    errors: [],
    cost: points * tokensPerVital,
    points,
    vitals: normalizedVitals,
  };
}

export function calculateRegenCost({
  regen,
  tokensPerRegen = COST_DEFAULTS.tokensPerRegen,
} = {}) {
  const errors = [];
  if (!Number.isInteger(tokensPerRegen) || tokensPerRegen <= 0) {
    addError(errors, "tokensPerRegen", "invalid_positive_int");
  }
  const normalizedRegen = normalizeRegen(regen, errors);
  const points = REGEN_KEYS.reduce((sum, key) => sum + (normalizedRegen[key] || 0), 0);
  if (errors.length > 0) {
    return { ok: false, errors, cost: 0, points, regen: normalizedRegen };
  }
  return {
    ok: true,
    errors: [],
    cost: points * tokensPerRegen,
    points,
    regen: normalizedRegen,
  };
}

export function calculateAffinityCost({
  stacks,
  affinityBaseCost = COST_DEFAULTS.affinityBaseCost,
  affinityStackExponent = COST_DEFAULTS.affinityStackExponent,
} = {}) {
  const errors = [];
  if (!Number.isInteger(affinityBaseCost) || affinityBaseCost <= 0) {
    addError(errors, "affinityBaseCost", "invalid_positive_int");
  }
  if (!Number.isInteger(affinityStackExponent) || affinityStackExponent <= 0) {
    addError(errors, "affinityStackExponent", "invalid_positive_int");
  }
  if (!Number.isInteger(stacks) || stacks < 1) {
    addError(errors, "stacks", "invalid_stacks");
  }
  if (errors.length > 0) {
    return { ok: false, errors, cost: 0 };
  }
  const cost = affinityBaseCost * Math.pow(stacks, affinityStackExponent);
  return { ok: true, errors: [], cost };
}

export function validateAffinityPrereqs({
  vitals,
  regen,
  affinities,
  fieldBase = "affinities",
  allowZeroReserveAffinityState = false,
  regenOptional = false,
} = {}) {
  const errors = [];
  if (!Array.isArray(affinities) || affinities.length === 0) {
    addError(errors, fieldBase, "missing_affinity");
    return { ok: false, errors };
  }
  const mana = Number.isInteger(vitals?.mana) ? vitals.mana : 0;
  const manaRegen = Number.isInteger(regen?.mana) ? regen.mana : 0;
  if (!allowZeroReserveAffinityState && mana <= 0) {
    addError(errors, fieldBase, "affinity_requires_mana");
  }
  if (!regenOptional && manaRegen <= 0) {
    addError(errors, fieldBase, "affinity_requires_mana_regen");
  }
  return { ok: errors.length === 0, errors };
}

function normalizeFixedPositionAffinity(input, errors, fieldBase) {
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_affinity");
    return null;
  }
  const kind = isNonEmptyString(input.kind) ? input.kind.trim() : "";
  if (!AFFINITY_KINDS.includes(kind)) {
    addError(errors, `${fieldBase}.kind`, "invalid_kind");
  }
  const expression = isNonEmptyString(input.expression) ? input.expression.trim() : "";
  if (!AFFINITY_EXPRESSIONS.includes(expression)) {
    addError(errors, `${fieldBase}.expression`, "invalid_expression");
  }
  const stacks = input.stacks === undefined ? 1 : readPositiveInt(input.stacks, `${fieldBase}.stacks`, errors);
  return {
    kind,
    expression,
    stacks,
  };
}

export function normalizeFixedPositionWorldActorCostProfile(input = {}, errors = [], fieldBase = "profile") {
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_profile");
    return null;
  }

  const id = isNonEmptyString(input.id) ? input.id.trim() : undefined;
  const kind = isNonEmptyString(input.kind) ? input.kind.trim() : "floor";
  if (!FIXED_POSITION_WORLD_ACTOR_KINDS.includes(kind)) {
    addError(errors, `${fieldBase}.kind`, "invalid_fixed_position_kind");
  }

  if (input.stationary !== undefined && input.stationary !== true) {
    addError(errors, `${fieldBase}.stationary`, "fixed_position_must_be_stationary");
  }
  const stationary = true;
  const neutralBaseline = input.neutralBaseline === true;
  const tokenCost = input.tokenCost === undefined
    ? WORLD_ACTOR_COST_DEFAULTS.neutralTokenCost
    : readPositiveInt(input.tokenCost, `${fieldBase}.tokenCost`, errors);
  const vitals = normalizeVitals(input.vitals, errors, `${fieldBase}.vitals`);
  const regen = normalizeRegen(input.regen, errors, `${fieldBase}.regen`);
  const affinity = input.affinity === undefined
    ? undefined
    : normalizeFixedPositionAffinity(input.affinity, errors, `${fieldBase}.affinity`);

  if (neutralBaseline) {
    if (tokenCost !== 1) {
      addError(errors, `${fieldBase}.tokenCost`, "neutral_baseline_requires_token_cost_1");
    }
    if ((affinity?.stacks || 0) > 0) {
      addError(errors, `${fieldBase}.affinity`, "neutral_baseline_requires_zero_affinity");
    }
    const hasNonZeroVital = VITAL_KEYS.some((key) => asNonNegativeInt(vitals[key], 0) > 0);
    if (hasNonZeroVital) {
      addError(errors, `${fieldBase}.vitals`, "neutral_baseline_requires_zero_vitals");
    }
    const hasNonZeroRegen = REGEN_KEYS.some((key) => asNonNegativeInt(regen[key], 0) > 0);
    if (hasNonZeroRegen) {
      addError(errors, `${fieldBase}.regen`, "neutral_baseline_requires_zero_regen");
    }
  }

  return {
    id,
    kind,
    stationary,
    neutralBaseline,
    tokenCost,
    vitals,
    regen,
    affinity,
  };
}

function normalizeTrapInvestmentProfile(input, errors, fieldBase) {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_trap_profile");
    return undefined;
  }
  const label = isNonEmptyString(input.label) ? input.label.trim() : undefined;
  const tokenCost = readPositiveInt(input.tokenCost, `${fieldBase}.tokenCost`, errors);
  const kind = isNonEmptyString(input.kind) ? input.kind.trim() : "";
  if (!AFFINITY_KINDS.includes(kind)) {
    addError(errors, `${fieldBase}.kind`, "invalid_kind");
  }
  const expression = isNonEmptyString(input.expression) ? input.expression.trim() : "";
  if (!AFFINITY_EXPRESSIONS.includes(expression)) {
    addError(errors, `${fieldBase}.expression`, "invalid_expression");
  }
  const stacks = readPositiveInt(input.stacks, `${fieldBase}.stacks`, errors);
  const manaReserve = readNonNegativeInt(input.manaReserve, `${fieldBase}.manaReserve`, errors);
  const manaRegen = readNonNegativeInt(input.manaRegen, `${fieldBase}.manaRegen`, errors);
  return {
    label,
    tokenCost,
    kind,
    expression,
    stacks,
    manaReserve,
    manaRegen,
  };
}

export function normalizeTrapArchetypeRules(input = {}, errors = [], fieldBase = "trapArchetype") {
  if (input === undefined) {
    return {
      ...DEFAULT_TRAP_ARCHETYPE_RULES,
      allowedExpressions: [...DEFAULT_TRAP_ARCHETYPE_RULES.allowedExpressions],
    };
  }
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_trap_archetype");
    return {
      ...DEFAULT_TRAP_ARCHETYPE_RULES,
      allowedExpressions: [...DEFAULT_TRAP_ARCHETYPE_RULES.allowedExpressions],
    };
  }

  const roomBounded = input.roomBounded === undefined ? true : input.roomBounded === true;
  const attackingOnly = input.attackingOnly === undefined ? true : input.attackingOnly === true;
  const maxAffinityCount = input.maxAffinityCount === undefined
    ? 1
    : readPositiveInt(input.maxAffinityCount, `${fieldBase}.maxAffinityCount`, errors);
  const maxExpressionCount = input.maxExpressionCount === undefined
    ? 1
    : readPositiveInt(input.maxExpressionCount, `${fieldBase}.maxExpressionCount`, errors);
  const stacksAllowed = input.stacksAllowed === undefined ? true : input.stacksAllowed === true;
  const manaReserveRequired = input.manaReserveRequired === undefined ? true : input.manaReserveRequired === true;
  const manaRegenOptional = input.manaRegenOptional === undefined ? true : input.manaRegenOptional === true;

  if (!roomBounded) {
    addError(errors, `${fieldBase}.roomBounded`, "trap_archetype_requires_room_bounded");
  }
  if (!attackingOnly) {
    addError(errors, `${fieldBase}.attackingOnly`, "trap_archetype_requires_attacking_only");
  }
  if (maxAffinityCount !== 1) {
    addError(errors, `${fieldBase}.maxAffinityCount`, "trap_archetype_requires_single_affinity");
  }
  if (maxExpressionCount !== 1) {
    addError(errors, `${fieldBase}.maxExpressionCount`, "trap_archetype_requires_single_expression");
  }
  if (!stacksAllowed) {
    addError(errors, `${fieldBase}.stacksAllowed`, "trap_archetype_requires_stack_support");
  }
  if (!manaReserveRequired) {
    addError(errors, `${fieldBase}.manaReserveRequired`, "trap_archetype_requires_mana_reserve");
  }

  const rawExpressions = Array.isArray(input.allowedExpressions) && input.allowedExpressions.length > 0
    ? ensureUniqueStrings(input.allowedExpressions)
    : [...DEFAULT_TRAP_ARCHETYPE_RULES.allowedExpressions];
  const allowedExpressions = rawExpressions.filter((entry) => AFFINITY_EXPRESSIONS.includes(entry));
  if (allowedExpressions.length !== rawExpressions.length || allowedExpressions.length === 0) {
    addError(errors, `${fieldBase}.allowedExpressions`, "invalid_allowed_expressions");
  }

  const highInvestmentProfile = normalizeTrapInvestmentProfile(
    input.highInvestmentProfile,
    errors,
    `${fieldBase}.highInvestmentProfile`,
  );

  return {
    roomBounded,
    attackingOnly,
    maxAffinityCount,
    maxExpressionCount,
    stacksAllowed,
    manaReserveRequired,
    manaRegenOptional,
    allowedExpressions,
    highInvestmentProfile,
  };
}

export function validateStationaryManaBudget({
  vitals,
  regen,
  affinities,
  fieldBase = "affinities",
  allowZeroReserveAffinityState = WORLD_ACTOR_COST_DEFAULTS.allowZeroReserveAffinityState,
  regenOptional = WORLD_ACTOR_COST_DEFAULTS.regenOptional,
} = {}) {
  const entries = Array.isArray(affinities) ? affinities.filter(Boolean) : [];
  if (entries.length === 0) {
    return { ok: true, errors: [] };
  }
  return validateAffinityPrereqs({
    vitals,
    regen,
    affinities: entries,
    fieldBase,
    allowZeroReserveAffinityState,
    regenOptional,
  });
}

export function calculateFixedPositionWorldActorCost({
  profile,
  tokensPerVital = COST_DEFAULTS.tokensPerVital,
  tokensPerRegen = COST_DEFAULTS.tokensPerRegen,
  affinityBaseCost = COST_DEFAULTS.affinityBaseCost,
  affinityStackExponent = COST_DEFAULTS.affinityStackExponent,
  manaReserveTokenDivisor = WORLD_ACTOR_COST_DEFAULTS.manaReserveTokenDivisor,
  allowZeroReserveAffinityState = WORLD_ACTOR_COST_DEFAULTS.allowZeroReserveAffinityState,
  regenOptional = WORLD_ACTOR_COST_DEFAULTS.regenOptional,
} = {}) {
  const errors = [];
  const normalizedProfile = normalizeFixedPositionWorldActorCostProfile(profile, errors, "profile");
  if (!normalizedProfile) {
    return { ok: false, errors, cost: 0 };
  }
  if (!Number.isInteger(manaReserveTokenDivisor) || manaReserveTokenDivisor <= 0) {
    addError(errors, "manaReserveTokenDivisor", "invalid_positive_int");
  }

  const vitalResult = calculateVitalCost({
    vitals: normalizedProfile.vitals,
    tokensPerVital,
  });
  if (!vitalResult.ok) errors.push(...vitalResult.errors);
  const regenResult = calculateRegenCost({
    regen: normalizedProfile.regen,
    tokensPerRegen,
  });
  if (!regenResult.ok) errors.push(...regenResult.errors);

  const affinityEntries = normalizedProfile.affinity ? [normalizedProfile.affinity] : [];
  const budgetValidation = validateStationaryManaBudget({
    vitals: vitalResult.vitals,
    regen: regenResult.regen,
    affinities: affinityEntries,
    allowZeroReserveAffinityState,
    regenOptional,
  });
  if (!budgetValidation.ok) {
    errors.push(...budgetValidation.errors);
  }

  let affinityCost = 0;
  affinityEntries.forEach((entry, index) => {
    const affinityResult = calculateAffinityCost({
      stacks: entry.stacks,
      affinityBaseCost,
      affinityStackExponent,
    });
    if (!affinityResult.ok) {
      affinityResult.errors.forEach((error) => {
        addError(errors, `profile.affinity[${index}].${error.field}`, error.code, error.detail);
      });
      return;
    }
    affinityCost += affinityResult.cost;
  });

  const manaReserve = asNonNegativeInt(vitalResult.vitals?.mana, 0);
  const manaReserveSurcharge = affinityEntries.length > 0
    ? Math.ceil(manaReserve / manaReserveTokenDivisor)
    : 0;

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      cost: 0,
      detail: {
        tokenCost: normalizedProfile.tokenCost,
        vitalPoints: vitalResult.points,
        regenPoints: regenResult.points,
        affinityCount: affinityEntries.length,
      },
    };
  }

  const cost = normalizedProfile.tokenCost + vitalResult.cost + regenResult.cost + affinityCost + manaReserveSurcharge;
  return {
    ok: true,
    errors: [],
    cost,
    detail: {
      tokenCost: normalizedProfile.tokenCost,
      vitalPoints: vitalResult.points,
      regenPoints: regenResult.points,
      affinityCount: affinityEntries.length,
      manaReserveSurcharge,
    },
  };
}

export function calculateActorCost({
  vitals,
  regen,
  affinityStacks = 1,
  tokensPerVital = COST_DEFAULTS.tokensPerVital,
  tokensPerRegen = COST_DEFAULTS.tokensPerRegen,
  affinityBaseCost = COST_DEFAULTS.affinityBaseCost,
  affinityStackExponent = COST_DEFAULTS.affinityStackExponent,
} = {}) {
  const errors = [];
  const vitalResult = calculateVitalCost({ vitals, tokensPerVital });
  if (!vitalResult.ok) {
    errors.push(...vitalResult.errors);
  }
  const regenResult = calculateRegenCost({ regen, tokensPerRegen });
  if (!regenResult.ok) {
    errors.push(...regenResult.errors);
  }

  if (vitalResult.points <= 0 && regenResult.points <= 0) {
    addError(errors, "vitals", "empty_vitals");
  }

  const affinityResult = calculateAffinityCost({
    stacks: affinityStacks,
    affinityBaseCost,
    affinityStackExponent,
  });
  if (!affinityResult.ok) {
    errors.push(...affinityResult.errors);
  }

  const mana = vitalResult.vitals?.mana || 0;
  const manaRegen = regenResult.regen?.mana || 0;
  if (affinityResult.ok) {
    if (mana <= 0) addError(errors, "affinities", "affinity_requires_mana");
    if (manaRegen <= 0) addError(errors, "affinities", "affinity_requires_mana_regen");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      cost: 0,
      detail: {
        vitalPoints: vitalResult.points,
        regenPoints: regenResult.points,
        affinityStacks,
      },
    };
  }

  const cost = vitalResult.cost + regenResult.cost + affinityResult.cost;
  return {
    ok: true,
    errors: [],
    cost,
    detail: {
      vitalPoints: vitalResult.points,
      regenPoints: regenResult.points,
      affinityStacks,
    },
  };
}

export {
  COST_DEFAULTS,
  COST_FORMULAS,
  DEFAULT_TRAP_ARCHETYPE_RULES,
  FIXED_POSITION_WORLD_ACTOR_KINDS,
  REGEN_KEYS,
  VITAL_KEYS,
  WORLD_ACTOR_COST_DEFAULTS,
};
