/**
 * Configurator motivation loadouts — artifact-level normalization of authored
 * motivations, and the persona's REJECTING validation surface.
 *
 * The motivation VOCABULARY (kinds, families, exclusivity, display groups) and its
 * pure lookups live in `contracts/domain-constants.js` (P5.1 D1/D2, decision D-n).
 * Two reasons they are not here:
 *   - This file used to re-alias GAME_MOTIVATION_KINDS as MOTIVATION_KINDS, making
 *     it the middle hop of a four-name chain and forcing every outside consumer to
 *     import a persona internal to read a shared vocabulary.
 *   - Exclusivity is DERIVED from the families, not authored by this persona.
 *
 * What stays: `normalizeMotivationKindList` and `normalizeMotivations`, the forms
 * that report *why* input was refused. The salvaging counterpart is
 * `coerceMotivationKinds` in contracts — all three cross-boundary callers used only
 * `.value` and discarded `ok`/`errors`/`warnings`, so ingesting loose input was never
 * a Configurator decision. "Is this configuration valid?" still is.
 */
import { GAME_MOTIVATION_KIND_IDS } from "../../contracts/game-elements.js";
import {
  MOTIVATION_FAMILIES,
  MOTIVATION_KINDS,
  normalizeMotivationKind,
} from "../../contracts/domain-constants.js";
import { findMotivationConflict } from "./logical-validation.js";

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

export const MOTIVATION_KIND_IDS = GAME_MOTIVATION_KIND_IDS;

const MOTIVATION_FLAG_KEYS = Object.freeze(["canMove", "prefersStealth", "prefersCover", "aggroRangeBoost"]);
const MOTIVATION_MAX_INTENSITY = 10;

function addError(errors, field, code) {
  errors.push({ field, code });
}

/**
 * The REJECTING form of motivation-list normalization: same `value` as
 * `coerceMotivationKinds` in contracts, plus the structured reasons anything was
 * dropped (`invalid_list`, `invalid_kind`, `conflicting_kind`).
 *
 * ⚠️ **NO PRODUCTION CONSUMER TODAY.** The three call sites that used to import this
 * across a persona boundary took only `.value` and threw the errors away, so they now
 * call `coerceMotivationKinds` directly. That means invalid or intra-family-conflicting
 * motivations are currently coerced silently in production rather than refused — the
 * same silent-fallback defect class as CR.1's `DEFAULT_ACTION_COST` and PX.3's default
 * clock. **Whether they SHOULD be refused is an open behavior decision** (it touches the
 * `ak_create` authoring path, so it is benchmark-relevant); this function is the seam
 * that decision would use. It is kept, not deleted, for that reason — and flagged here
 * rather than left looking load-bearing.
 */
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
  list.forEach((entry, index) => {
    const kind = normalizeMotivationKind(entry);
    if (!kind) {
      addError(errors, `${fieldBase}[${index}]`, "invalid_kind");
      return;
    }
    if (seen.has(kind)) return;
    if (findMotivationConflict(value, kind)) {
      addError(errors, `${fieldBase}[${index}]`, "conflicting_kind");
      return;
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
  list.forEach((entry, index) => {
    const normalized = normalizeMotivation(entry, `${fieldBase}[${index}]`, errors);
    if (normalized) {
      if (findMotivationConflict(value, normalized.kind)) {
        addError(errors, `${fieldBase}[${index}]`, "conflicting_kind");
        return;
      }
      value.push(normalized);
    }
  });

  return { ok: errors.length === 0, errors, warnings, value };
}
