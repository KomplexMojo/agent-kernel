import { AFFINITY_KINDS } from "./affinity-loadouts.js";
import { MOTIVATION_KINDS } from "./motivation-loadouts.js";

const TYPE = "actor";
const SUB_TYPES = Object.freeze(["static", "dynamic", "trap"]);

function addError(errors, field, code) {
  errors.push({ field, code });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateStringArray(value, field, errors) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    addError(errors, field, "invalid_string_array");
    return undefined;
  }
  return value.map((v) => v.trim());
}

function normalizeMeta(meta, base, errors) {
  if (meta === undefined) return undefined;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    addError(errors, base, "invalid_meta");
    return undefined;
  }
  const result = {};
  if (meta.sizeHint !== undefined) {
    if (!isNonEmptyString(meta.sizeHint)) {
      addError(errors, `${base}.sizeHint`, "invalid_size_hint");
    } else {
      result.sizeHint = meta.sizeHint.trim();
    }
  }
  if (meta.hazard !== undefined) {
    if (!isNonEmptyString(meta.hazard)) {
      addError(errors, `${base}.hazard`, "invalid_hazard");
    } else {
      result.hazard = meta.hazard.trim();
    }
  }
  if (meta.mobility !== undefined) {
    if (typeof meta.mobility !== "boolean") {
      addError(errors, `${base}.mobility`, "invalid_mobility");
    } else {
      result.mobility = meta.mobility;
    }
  }
  if (meta.bossCapable !== undefined) {
    if (typeof meta.bossCapable !== "boolean") {
      addError(errors, `${base}.bossCapable`, "invalid_boss_flag");
    } else {
      result.bossCapable = meta.bossCapable;
    }
  }
  return result;
}

function normalizeEntry(entry, index, errors, seenIds) {
  const base = `entries[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    addError(errors, base, "invalid_entry");
    return null;
  }

  const { id, type, subType, motivation, affinity, cost } = entry;

  if (!isNonEmptyString(id)) {
    addError(errors, `${base}.id`, "invalid_id");
  } else if (seenIds.has(id)) {
    addError(errors, `${base}.id`, "duplicate_id");
  } else {
    seenIds.add(id);
  }

  if (type !== TYPE) {
    addError(errors, `${base}.type`, "invalid_type");
  }

  if (!isNonEmptyString(subType) || !SUB_TYPES.includes(subType)) {
    addError(errors, `${base}.subType`, "invalid_sub_type");
  }

  if (!isNonEmptyString(motivation) || !MOTIVATION_KINDS.includes(motivation)) {
    addError(errors, `${base}.motivation`, "invalid_motivation");
  }

  if (!isNonEmptyString(affinity) || !AFFINITY_KINDS.includes(affinity)) {
    addError(errors, `${base}.affinity`, "invalid_affinity");
  }

  if (!Number.isInteger(cost) || cost <= 0) {
    addError(errors, `${base}.cost`, "invalid_cost");
  }

  const tags = validateStringArray(entry.tags, `${base}.tags`, errors);
  const meta = normalizeMeta(entry.meta, `${base}.meta`, errors);

  return {
    id,
    type: TYPE,
    subType,
    motivation,
    affinity,
    cost,
    tags: tags || [],
    meta,
  };
}

export function normalizePoolCatalog(input = {}) {
  const errors = [];
  const warnings = [];
  const entriesInput = input.entries ?? input.catalog ?? input.items ?? input;
  if (!Array.isArray(entriesInput)) {
    addError(errors, "entries", "invalid_list");
    return { ok: false, errors, warnings, entries: [] };
  }

  const seenIds = new Set();
  const entries = [];
  entriesInput.forEach((entry, index) => {
    const normalized = normalizeEntry(entry, index, errors, seenIds);
    if (normalized) {
      entries.push(normalized);
    }
  });

  entries.sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type);
    if (typeOrder !== 0) return typeOrder;
    const motivationOrder = a.motivation.localeCompare(b.motivation);
    if (motivationOrder !== 0) return motivationOrder;
    const affinityOrder = a.affinity.localeCompare(b.affinity);
    if (affinityOrder !== 0) return affinityOrder;
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.id.localeCompare(b.id);
  });

  return { ok: errors.length === 0, errors, warnings, entries };
}
