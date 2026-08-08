/**
 * Pool-catalog vocabulary — what a catalog entry IS, and whether one is well-formed.
 *
 * ⚠️ RELOCATED 2026-08-08 (D8-V) from `personas/configurator/pool-catalog.js`, by
 * maintainer decision: **this is shared vocabulary, not persona-owned.** Everything here
 * validates, normalizes and sorts. It **prices nothing and decides nothing** — `cost` is
 * checked for being a positive integer and is otherwise never read. Routing a pure data
 * validator through an FSM-gated controller would have been ceremony, and it would have
 * needed a controller method on a persona that never called it.
 *
 * Its two importers — `director/pool-mapper.js` and `orchestrator/llm-budget-loop.js` —
 * were BOTH persona-boundary allowlist rows, and `pool-mapper`'s was the whole of D8.2.
 * Both die by relocation rather than by threading. This is the line
 * `domain-constants.js` already draws for tile fields: *what stays in contracts is
 * VOCABULARY, not economy.*
 *
 * Address is not authority: the Configurator never imported this file either. It sat in
 * that directory because the first caller of it was Configurator-adjacent.
 */
// AFFINITY_KINDS used to be read from `configurator/affinity-loadouts.js`, which merely
// re-exports it from here — a laundering hop of the class P5.1 catalogued. Both vocabularies
// now come from the one origin, as MOTIVATION_KINDS already did.
import { AFFINITY_KINDS, MOTIVATION_KINDS } from "./domain-constants.js";

const TYPE = "actor";
const SUB_TYPES = Object.freeze(["static", "dynamic", "hazard"]);

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
