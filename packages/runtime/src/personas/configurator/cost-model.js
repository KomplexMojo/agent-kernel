/**
 * Affinity SHAPE and affinity RUNTIME MATH for the Configurator.
 *
 * ⚠️ **THIS MODULE NO LONGER PRICES ANYTHING — P1.4, 2026-08-12.** It used to carry a
 * second set of cost constants that disagreed with the Allocator's price list on nearly
 * every value: affinity base 30 vs 10, stacks `Σ(10 + 8·(n-1)²)` vs linear, vital points
 * `2·H` vs 1 each, regen `12·R²` vs per-tick. Those constants, and the four
 * `calculate*Cost` functions that used them, are gone.
 *
 * **They were DEAD when they were deleted, and that is the whole finding.** The census
 * (repo-wide, `packages/` + `scripts/` + `tools/`) found their only consumer to be
 * `configurator/actor-config-generation.js` — a module with zero production importers,
 * reachable solely from its own test. The live actor pricing is the Allocator's
 * `spend-proposal.js#calculateActorConfigurationUnitCost`, which reads the price list
 * through `requireEntry` and pushes an error on a miss. For an unknown stretch this file's
 * header, `allocator/README.md` and a "pinned divergence" test all described the divergence
 * as charging real receipts; it had stopped.
 *
 * ⇒ **Pricing has ONE origin: `personas/allocator/`.** `tests/architecture/single-origin.js`
 * now forbids a second declaration of vital / regen / affinity price constants outside it,
 * so this cannot grow back quietly the way it grew in the first place.
 *
 * What legitimately lives here, and why it is not pricing:
 *   - **Normalizers** (`normalizeVitals`, `normalizeRegen`, `normalizeAffinityList`) and
 *     **prerequisites** (`validateAffinityPrereqs`) — configuration SHAPE, which is
 *     Configurator law.
 *   - **Runtime affinity math** (`computeExternalManaUse`, `computeInternalManaUpkeep`,
 *     `computeExternalRange`, `computeInternalRadius`, `computeDrawNet`,
 *     `computeEmitStrength`) — what an affinity DOES during a tick, in mana and tiles, with
 *     its own literals. None of it is denominated in tokens, and none of it ever read the
 *     deleted constants.
 */
import { VITAL_KEYS } from "../../contracts/domain-constants.js";

const REGEN_KEYS = Object.freeze([...VITAL_KEYS]);

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


