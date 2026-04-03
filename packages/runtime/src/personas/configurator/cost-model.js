import { VITAL_KEYS } from "../../contracts/domain-constants.js";

const REGEN_KEYS = Object.freeze(VITAL_KEYS.filter((key) => key !== "durability"));

const COST_DEFAULTS = Object.freeze({
  tokensPerVital: 1,
  tokensPerRegen: 2,
  affinityBaseCost: 4,
  affinityStackExponent: 2,
});

const COST_FORMULAS = Object.freeze({
  vitalCost: "vitalCost = (health + mana + stamina + durability) * tokensPerVital",
  regenCost: "regenCost = (healthRegen + manaRegen + staminaRegen) * tokensPerRegen",
  affinityCost: "affinityCost = affinityBaseCost * stacks ^ affinityStackExponent",
  totalCost: "totalCost = vitalCost + regenCost + affinityCost",
  notes: [
    "Affinities require mana > 0 and manaRegen > 0.",
    "Durability regen is unsupported.",
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

export { COST_DEFAULTS, COST_FORMULAS, VITAL_KEYS, REGEN_KEYS };
