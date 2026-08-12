import {
  COST_DEFAULTS,
  calculateAffinityCost,
  calculateActorCost,
  calculateRegenCost,
  calculateVitalCost,
  normalizeAffinityList,
  validateAffinityPrereqs,
} from "./cost-model.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addError(errors, field, code, detail) {
  const entry = { field, code };
  if (detail !== undefined) entry.detail = detail;
  errors.push(entry);
}

function normalizeTags(tags, errors, base) {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || !tags.every(isNonEmptyString)) {
    addError(errors, base, "invalid_string_array");
    return [];
  }
  return tags.map((tag) => tag.trim());
}

function normalizeMeta(meta, errors, base) {
  if (meta === undefined) return undefined;
  if (!isPlainObject(meta)) {
    addError(errors, base, "invalid_object");
    return undefined;
  }
  return { ...meta };
}

export function buildActorCatalogFromConfig({
  roles,
  affinities,
  tokensPerVital = COST_DEFAULTS.tokensPerVital,
  tokensPerRegen = COST_DEFAULTS.tokensPerRegen,
  affinityBaseCost = COST_DEFAULTS.affinityBaseCost,
  affinityStackExponent = COST_DEFAULTS.affinityStackExponent,
  idPrefix = "actor",
} = {}) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(roles) || roles.length === 0) {
    addError(errors, "roles", "invalid_list");
  }
  const normalizedAffinities = normalizeAffinityList(affinities, errors, "affinities");

  if (errors.length > 0) {
    return { ok: false, errors, warnings, entries: [] };
  }

  const entries = [];
  const seenIds = new Set();

  roles.forEach((role, roleIndex) => {
    const base = `roles[${roleIndex}]`;
    if (!isPlainObject(role)) {
      addError(errors, base, "invalid_role");
      return;
    }

    if (!isNonEmptyString(role.motivation)) {
      addError(errors, `${base}.motivation`, "invalid_motivation");
    }
    if (!isNonEmptyString(role.subType)) {
      addError(errors, `${base}.subType`, "invalid_sub_type");
    }

    const vitalResult = calculateVitalCost({
      vitals: role.vitals,
      tokensPerVital,
    });
    if (!vitalResult.ok) {
      vitalResult.errors.forEach((err) => {
        addError(errors, `${base}.${err.field}`, err.code, err.detail);
      });
    }
    const regenResult = calculateRegenCost({
      regen: role.regen,
      tokensPerRegen,
    });
    if (!regenResult.ok) {
      regenResult.errors.forEach((err) => {
        addError(errors, `${base}.${err.field}`, err.code, err.detail);
      });
    }

    const affinityPrereqs = validateAffinityPrereqs({
      vitals: vitalResult.vitals,
      regen: regenResult.regen,
      affinities: normalizedAffinities,
      fieldBase: `${base}.affinities`,
    });
    if (!affinityPrereqs.ok) {
      affinityPrereqs.errors.forEach((err) => {
        addError(errors, err.field, err.code, err.detail);
      });
    }

    if (errors.length > 0) return;

    if (vitalResult.points <= 0 && regenResult.points <= 0) {
      addError(errors, `${base}.vitals`, "empty_vitals");
      return;
    }

    const tags = normalizeTags(role.tags, errors, `${base}.tags`);
    const meta = normalizeMeta(role.meta, errors, `${base}.meta`);
    if (errors.length > 0) return;

    normalizedAffinities.forEach((affinity, affinityIndex) => {
      const affinityResult = calculateAffinityCost({
        stacks: affinity.stacks,
        affinityBaseCost,
        affinityStackExponent,
      });
      if (!affinityResult.ok) {
        affinityResult.errors.forEach((err) => {
          addError(errors, `${base}.affinities[${affinityIndex}].${err.field}`, err.code, err.detail);
        });
        return;
      }

      const cost = vitalResult.cost + regenResult.cost + affinityResult.cost;
      if (cost <= 0) {
        addError(errors, `${base}.cost`, "invalid_cost");
        return;
      }

      const id = `${idPrefix}_${role.motivation}_${affinity.kind}_${cost}`;
      if (seenIds.has(id)) {
        addError(errors, `${base}.id`, "duplicate_id", { id });
        return;
      }
      seenIds.add(id);

      entries.push({
        id,
        type: "actor",
        subType: role.subType,
        motivation: role.motivation,
        affinity: affinity.kind,
        cost,
        tags,
        meta,
      });
    });
  });

  return { ok: errors.length === 0, errors, warnings, entries };
}

export { calculateActorCost };

export function buildActorCatalogFromAtoms(options = {}) {
  return buildActorCatalogFromConfig(options);
}

export function calculateAtomCost(options = {}) {
  return calculateActorCost(options);
}
