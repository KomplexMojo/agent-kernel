import { VITAL_KEYS } from "../../contracts/domain-constants.js";

const REGEN_KEYS = Object.freeze([...VITAL_KEYS]);

/**
 * Per-vital max cost multipliers (design §7):
 *   health: 2H, mana: 2M, stamina: S, durability: 2D
 */
const VITAL_MAX_COST_MULTIPLIER = Object.freeze({
  health: 2,
  mana: 2,
  stamina: 1,
  durability: 2,
});

/**
 * Per-vital regen cost coefficients (design §8, quadratic):
 *   health: 12·R², mana: 5·R², stamina: 4·R², durability: 10·R²
 */
const REGEN_COST_COEFFICIENT = Object.freeze({
  health: 12,
  mana: 5,
  stamina: 4,
  durability: 10,
});

const COST_DEFAULTS = Object.freeze({
  /** @deprecated Use VITAL_MAX_COST_MULTIPLIER per-vital instead. */
  tokensPerVital: 1,
  /** @deprecated Use REGEN_COST_COEFFICIENT per-vital instead. */
  tokensPerRegen: 2,
  affinityBaseCost: 30,
  /**
   * Affinity stack cost formula: 10 + 8·(n-1)² per stack n (design §6.2).
   * affinityStackExponent is kept for legacy callers but the canonical
   * formula is now computeStackCost().
   */
  affinityStackExponent: 2,
  /** Build-time cost for external expressions (push/pull) (design §6.4). */
  externalExpressionCost: 35,
  /** Build-time cost for internal expressions (emit/draw) (design §6.4). */
  internalExpressionCost: 25,
  /** Flat cost for a simple motivation (design §6.6). */
  simpleMotivationCost: 25,
  /** Flat cost for an advanced motivation (design §6.6). */
  advancedMotivationCost: 50,
});

const COST_FORMULAS = Object.freeze({
  vitalCost: "vitalCost = 2·H + 2·M + S + 2·D",
  regenCost: "regenCost = 12·Rh² + 5·Rm² + 4·Rs² + 10·Rd²",
  affinityCost: "affinityCost = 30·A + Σ(10 + 8·(n-1)²) + 35·Ex + 25·Ei",
  totalCost: "totalCost = vitalCost + regenCost + affinityCost + motivationCost",
  notes: [
    "Affinities require mana > 0 and manaRegen > 0.",
    "Durability regen is supported (10·Rd²).",
  ],
});

/**
 * Canonical affinity stack cost for stack number n (1-indexed).
 * Formula: 10 + 8·(n-1)²  (design §6.2)
 */
export function computeStackCost(n) {
  if (!Number.isInteger(n) || n < 1) return 0;
  return 10 + 8 * Math.pow(n - 1, 2);
}

/**
 * Cumulative cost for stacks 1..totalStacks in one affinity.
 */
export function computeCumulativeStackCost(totalStacks) {
  if (!Number.isInteger(totalStacks) || totalStacks < 1) return 0;
  let sum = 0;
  for (let n = 1; n <= totalStacks; n++) {
    sum += computeStackCost(n);
  }
  return sum;
}

/**
 * External expression runtime mana cost for stack s (design §9.1).
 * Formula: 5 + 4·(s-1)²
 */
export function computeExternalManaUse(s) {
  if (!Number.isInteger(s) || s < 1) return 0;
  return 5 + 4 * Math.pow(s - 1, 2);
}

/**
 * Internal expression upkeep per turn for stack s (design §9.2).
 * Formula: 2 + s
 */
export function computeInternalManaUpkeep(s) {
  if (!Number.isInteger(s) || s < 1) return 0;
  return 2 + s;
}

/**
 * External expression range for stack s (design §10.1).
 * Formula: 1 + s
 */
export function computeExternalRange(s) {
  if (!Number.isInteger(s) || s < 1) return 0;
  return 1 + s;
}

/**
 * Internal expression radius for stack s (design §10.2).
 * Formula: 1 + s
 */
export function computeInternalRadius(s) {
  if (!Number.isInteger(s) || s < 1) return 0;
  return 1 + s;
}

/**
 * Draw net mana formula (design §11.3).
 * DrawNet(s, e) = 3·min(s, e) - (2 + s)
 */
export function computeDrawNet(s, e) {
  if (!Number.isInteger(s) || s < 1) return 0;
  if (!Number.isInteger(e) || e < 0) return -(2 + s);
  return 3 * Math.min(s, e) - (2 + s);
}

/**
 * Emit strength for stack s (design §12.2).
 * EmitStrength(s) = s
 */
export function computeEmitStrength(s) {
  if (!Number.isInteger(s) || s < 1) return 0;
  return s;
}

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
  const result = {};
  REGEN_KEYS.forEach((key) => {
    if (regen[key] !== undefined) {
      result[key] = readNonNegativeInt(regen[key], `${fieldBase}.${key}`, errors);
    }
  });
  return result;
}

const VALID_EXPRESSIONS = new Set(["push", "pull", "emit", "draw"]);

/**
 * Normalize and validate an affinity list.
 *
 * Design §5.1: An affinity is NOT valid unless it includes:
 *   - the affinity kind
 *   - at least 1 stack (s >= 1)
 *   - at least 1 expression (push/pull/emit/draw)
 */
export function normalizeAffinityList(affinities, errors, fieldBase = "affinities") {
  if (!Array.isArray(affinities) || affinities.length === 0) {
    addError(errors, fieldBase, "missing_affinity");
    return [];
  }
  return affinities.reduce((list, entry, index) => {
    const base = `${fieldBase}[${index}]`;
    if (isNonEmptyString(entry)) {
      // Bare string affinity kind — invalid without stack + expression (design §5.1)
      addError(errors, base, "affinity_missing_stack_and_expression");
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
    // Expression is required for a valid affinity package (design §5.1)
    const expression = entry.expression;
    if (!expression || !VALID_EXPRESSIONS.has(expression)) {
      addError(errors, `${base}.expression`, "affinity_requires_expression");
      return list;
    }
    list.push({ kind: entry.kind.trim(), stacks, expression });
    return list;
  }, []);
}

export function calculateVitalCost({
  vitals,
  tokensPerVital,
} = {}) {
  const errors = [];
  const normalizedVitals = normalizeVitals(vitals, errors);
  const points = VITAL_KEYS.reduce((sum, key) => sum + (normalizedVitals[key] || 0), 0);
  if (errors.length > 0) {
    return { ok: false, errors, cost: 0, points, vitals: normalizedVitals };
  }
  // Per-vital cost: health×2 + mana×2 + stamina×1 + durability×2 (design §7)
  let cost = 0;
  VITAL_KEYS.forEach((key) => {
    const value = normalizedVitals[key] || 0;
    const multiplier = tokensPerVital != null ? tokensPerVital : VITAL_MAX_COST_MULTIPLIER[key];
    cost += value * multiplier;
  });
  return {
    ok: true,
    errors: [],
    cost,
    points,
    vitals: normalizedVitals,
  };
}

export function calculateRegenCost({
  regen,
  tokensPerRegen,
} = {}) {
  const errors = [];
  const normalizedRegen = normalizeRegen(regen, errors);
  const points = REGEN_KEYS.reduce((sum, key) => sum + (normalizedRegen[key] || 0), 0);
  if (errors.length > 0) {
    return { ok: false, errors, cost: 0, points, regen: normalizedRegen };
  }
  // Per-vital quadratic regen cost (design §8):
  //   health: 12·R², mana: 5·R², stamina: 4·R², durability: 10·R²
  let cost = 0;
  REGEN_KEYS.forEach((key) => {
    const value = normalizedRegen[key] || 0;
    if (tokensPerRegen != null) {
      // Legacy linear mode for callers that override
      cost += value * tokensPerRegen;
    } else {
      const coeff = REGEN_COST_COEFFICIENT[key];
      cost += coeff * value * value;
    }
  });
  return {
    ok: true,
    errors: [],
    cost,
    points,
    regen: normalizedRegen,
  };
}

export function calculateAffinityCost({
  stacks,
  affinityBaseCost = COST_DEFAULTS.affinityBaseCost,
} = {}) {
  const errors = [];
  if (!Number.isInteger(affinityBaseCost) || affinityBaseCost <= 0) {
    addError(errors, "affinityBaseCost", "invalid_positive_int");
  }
  if (!Number.isInteger(stacks) || stacks < 1) {
    addError(errors, "stacks", "invalid_stacks");
  }
  if (errors.length > 0) {
    return { ok: false, errors, cost: 0 };
  }
  // Design §6: affinity base (30) + cumulative stack cost Σ(10 + 8·(n-1)²)
  const stackCost = computeCumulativeStackCost(stacks);
  const cost = affinityBaseCost + stackCost;
  return { ok: true, errors: [], cost };
}

export function validateAffinityPrereqs({
  vitals,
  regen,
  affinities,
  fieldBase = "affinities",
} = {}) {
  const errors = [];
  if (!Array.isArray(affinities) || affinities.length === 0) {
    addError(errors, fieldBase, "missing_affinity");
    return { ok: false, errors };
  }
  const mana = Number.isInteger(vitals?.mana) ? vitals.mana : 0;
  const manaRegen = Number.isInteger(regen?.mana) ? regen.mana : 0;
  if (mana <= 0) {
    addError(errors, fieldBase, "affinity_requires_mana");
  }
  if (manaRegen <= 0) {
    addError(errors, fieldBase, "affinity_requires_mana_regen");
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Full agent cost calculation (design §13).
 *
 * AgentCost = 30·A + Σ stackCosts + 35·Ex + 25·Ei + motivationCost
 *           + 2H + 2M + S + 2D + 12·Rh² + 5·Rm² + 4·Rs² + 10·Rd²
 *
 * @param {Object} options
 * @param {Object} options.vitals - { health, mana, stamina, durability } max values
 * @param {Object} options.regen - { health, mana, stamina, durability } regen-per-turn values
 * @param {Array} options.affinities - Array of { kind, stacks, expression } packages
 * @param {Array} options.motivations - Array of { kind, tier } where tier is "simple" or "advanced"
 * @param {number} options.simpleMotivationCost - Override for simple motivation flat cost
 * @param {number} options.advancedMotivationCost - Override for advanced motivation flat cost
 */
export function calculateActorCost({
  vitals,
  regen,
  affinityStacks = 1,
  affinities,
  motivations,
  simpleMotivationCost = COST_DEFAULTS.simpleMotivationCost,
  advancedMotivationCost = COST_DEFAULTS.advancedMotivationCost,
} = {}) {
  const errors = [];
  const vitalResult = calculateVitalCost({ vitals });
  if (!vitalResult.ok) {
    errors.push(...vitalResult.errors);
  }
  const regenResult = calculateRegenCost({ regen });
  if (!regenResult.ok) {
    errors.push(...regenResult.errors);
  }

  if (vitalResult.points <= 0 && regenResult.points <= 0) {
    addError(errors, "vitals", "empty_vitals");
  }

  // Affinity cost: per-affinity base (30) + cumulative stack cost + expression cost
  let affinityCost = 0;
  let totalAffinityStacks = 0;
  let externalExpressions = 0;
  let internalExpressions = 0;

  const affinityList = Array.isArray(affinities) ? affinities : [];
  if (affinityList.length > 0) {
    affinityList.forEach((entry, index) => {
      const stacks = Number.isInteger(entry?.stacks) && entry.stacks >= 1 ? entry.stacks : 1;
      const expression = entry?.expression;
      totalAffinityStacks += stacks;

      // Validate: each affinity package needs an expression
      if (!expression) {
        addError(errors, `affinities[${index}]`, "affinity_requires_expression");
      }

      // Base cost (30) + cumulative stack cost
      affinityCost += COST_DEFAULTS.affinityBaseCost + computeCumulativeStackCost(stacks);

      // Expression cost
      if (expression === "push" || expression === "pull") {
        externalExpressions += 1;
        affinityCost += COST_DEFAULTS.externalExpressionCost;
      } else if (expression === "emit" || expression === "draw") {
        internalExpressions += 1;
        affinityCost += COST_DEFAULTS.internalExpressionCost;
      }
    });
  } else if (Number.isInteger(affinityStacks) && affinityStacks >= 1) {
    // Legacy single-affinity mode
    totalAffinityStacks = affinityStacks;
    affinityCost = COST_DEFAULTS.affinityBaseCost + computeCumulativeStackCost(affinityStacks);
  }

  // Mana prereqs for affinities
  const mana = vitalResult.vitals?.mana || 0;
  const manaRegen = regenResult.regen?.mana || 0;
  if (affinityCost > 0) {
    if (mana <= 0) addError(errors, "affinities", "affinity_requires_mana");
    if (manaRegen <= 0) addError(errors, "affinities", "affinity_requires_mana_regen");
  }

  // Motivation cost (design §6.6)
  let motivationCost = 0;
  if (Array.isArray(motivations)) {
    motivations.forEach((m) => {
      if (m?.tier === "advanced") {
        motivationCost += advancedMotivationCost;
      } else {
        motivationCost += simpleMotivationCost;
      }
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      cost: 0,
      detail: {
        vitalPoints: vitalResult.points,
        regenPoints: regenResult.points,
        affinityStacks: totalAffinityStacks,
        externalExpressions,
        internalExpressions,
        motivationCost,
      },
    };
  }

  const cost = vitalResult.cost + regenResult.cost + affinityCost + motivationCost;
  return {
    ok: true,
    errors: [],
    cost,
    detail: {
      vitalCost: vitalResult.cost,
      regenCost: regenResult.cost,
      affinityCost,
      motivationCost,
      vitalPoints: vitalResult.points,
      regenPoints: regenResult.points,
      affinityStacks: totalAffinityStacks,
      externalExpressions,
      internalExpressions,
    },
  };
}

export {
  COST_DEFAULTS,
  COST_FORMULAS,
  VITAL_KEYS,
  REGEN_KEYS,
  VITAL_MAX_COST_MULTIPLIER,
  REGEN_COST_COEFFICIENT,
};
