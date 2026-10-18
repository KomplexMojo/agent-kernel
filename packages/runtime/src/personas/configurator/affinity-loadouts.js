import { AFFINITY_DEFAULTS } from "./defaults.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_TARGET_TYPES,
  DEFAULT_AFFINITY_EXPRESSION,
  DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";
import {
  assessAffinityStackTier,
  assessConfiguredAffinitySlots,
} from "./logical-validation.js";

export { AFFINITY_KINDS, AFFINITY_EXPRESSIONS, AFFINITY_TARGET_TYPES };
const STACK_SCALING = Object.freeze(["linear", "multiplier"]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function addError(errors, field, code, actorId) {
  if (actorId) {
    errors.push({ field, code, actorId });
    return;
  }
  errors.push({ field, code });
}

function defaultTargetTypeForExpression(expression) {
  return DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION[expression]
    || DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION[DEFAULT_AFFINITY_EXPRESSION];
}

function normalizeVitalModifier(modifier, fieldBase, errors) {
  if (!isPlainObject(modifier)) {
    addError(errors, fieldBase, "invalid_vital_modifier");
    return null;
  }
  if (!isNumber(modifier.current)) {
    addError(errors, `${fieldBase}.current`, "invalid_modifier_value");
  }
  if (!isNumber(modifier.max)) {
    addError(errors, `${fieldBase}.max`, "invalid_modifier_value");
  }
  if (!isNumber(modifier.regen)) {
    addError(errors, `${fieldBase}.regen`, "invalid_modifier_value");
  }
  return {
    current: modifier.current,
    max: modifier.max,
    regen: modifier.regen,
  };
}

// #264 — presets carry no attack/buff/area effects or abilities (schemaVersion 2). A v1
// catalog's `effects`/`abilities` are read and ignored: nothing consumed them, because
// there is no conventional attack and harm comes only from affinity casts.
export function normalizeAffinityPresetCatalog(input = {}) {
  const errors = [];
  const warnings = [];
  const presetsInput = input.presets;

  if (!Array.isArray(presetsInput)) {
    addError(errors, "presets", "invalid_list");
    return { ok: false, errors, warnings, value: null };
  }

  const seenIds = new Set();
  const presets = [];

  presetsInput.forEach((preset, index) => {
    const base = `presets[${index}]`;
    if (!isPlainObject(preset)) {
      addError(errors, base, "invalid_preset");
      return;
    }
    if (typeof preset.id !== "string" || preset.id.trim() === "") {
      addError(errors, `${base}.id`, "invalid_id");
      return;
    }
    if (seenIds.has(preset.id)) {
      addError(errors, `${base}.id`, "duplicate_id");
      return;
    }
    seenIds.add(preset.id);

    if (!AFFINITY_KINDS.includes(preset.kind)) {
      addError(errors, `${base}.kind`, "invalid_kind");
    }
    if (!AFFINITY_EXPRESSIONS.includes(preset.expression)) {
      addError(errors, `${base}.expression`, "invalid_expression");
    }

    const manaCost = preset.manaCost === undefined ? AFFINITY_DEFAULTS.manaCost : preset.manaCost;
    if (!isNumber(manaCost) || manaCost < 0 || !isInteger(manaCost)) {
      addError(errors, `${base}.manaCost`, "invalid_mana_cost");
    }

    if (!isPlainObject(preset.stack)) {
      addError(errors, `${base}.stack`, "invalid_stack");
    } else {
      if (!isInteger(preset.stack.max) || preset.stack.max < 1) {
        addError(errors, `${base}.stack.max`, "invalid_stack_max");
      }
      if (!STACK_SCALING.includes(preset.stack.scaling)) {
        addError(errors, `${base}.stack.scaling`, "invalid_stack_scaling");
      }
    }

    if (preset.vitalsModifiers !== undefined) {
      if (!isPlainObject(preset.vitalsModifiers)) {
        addError(errors, `${base}.vitalsModifiers`, "invalid_vitals_modifiers");
      } else {
        VITAL_KEYS.forEach((key) => {
          if (preset.vitalsModifiers[key]) {
            normalizeVitalModifier(preset.vitalsModifiers[key], `${base}.vitalsModifiers.${key}`, errors);
          }
        });
      }
    }

    if (preset.expression === "draw") {
      if (!preset.vitalsModifiers?.mana) {
        addError(errors, `${base}.vitalsModifiers.mana`, "missing_mana_modifier");
      }
    }

    presets.push({
      id: preset.id,
      kind: preset.kind,
      expression: preset.expression,
      manaCost,
      vitalsModifiers: preset.vitalsModifiers,
      stack: preset.stack,
    });
  });

  const ok = errors.length === 0;
  return { ok, errors, warnings, value: ok ? { presets } : null };
}

export function normalizeActorLoadoutCatalog(
  input = {},
  { presets = [], requiredExpressionsByActorId = null, requiredExpressionsDefault = null } = {},
) {
  const errors = [];
  const warnings = [];
  const loadoutsInput = input.loadouts;

  if (!Array.isArray(loadoutsInput)) {
    addError(errors, "loadouts", "invalid_list");
    return { ok: false, errors, warnings, value: null };
  }

  const presetIndex = new Map();
  presets.forEach((preset) => {
    if (preset && typeof preset.id === "string") {
      presetIndex.set(preset.id, preset);
    }
  });

  const loadouts = [];
  loadoutsInput.forEach((loadout, index) => {
    const base = `loadouts[${index}]`;
    if (!isPlainObject(loadout)) {
      addError(errors, base, "invalid_loadout");
      return;
    }
    const actorIdValue = typeof loadout.actorId === "string" && loadout.actorId.trim() !== "" ? loadout.actorId : null;
    if (loadout.weapons || loadout.equipment || loadout.items) {
      addError(errors, `${base}.equipment`, "non_affinity_equipment", actorIdValue);
    }
    if (typeof loadout.actorId !== "string" || loadout.actorId.trim() === "") {
      addError(errors, `${base}.actorId`, "invalid_actor_id", actorIdValue);
    }
    const affinitiesInput = loadout.affinities === undefined ? [] : loadout.affinities;
    if (!Array.isArray(affinitiesInput)) {
      addError(errors, `${base}.affinities`, "invalid_list", actorIdValue);
      return;
    }
    assessConfiguredAffinitySlots({
      affinities: affinitiesInput,
      path: `${base}.affinities`,
      actorId: actorIdValue,
    }).forEach((issue) => addError(errors, issue.path, issue.code, issue.actorId));
    const affinities = affinitiesInput.map((affinity, affinityIndex) => {
      const affinityBase = `${base}.affinities[${affinityIndex}]`;
      if (!isPlainObject(affinity)) {
        addError(errors, affinityBase, "invalid_affinity", actorIdValue);
        return null;
      }
      if (!AFFINITY_KINDS.includes(affinity.kind)) {
        addError(errors, `${affinityBase}.kind`, "invalid_kind", actorIdValue);
      }
      if (!AFFINITY_EXPRESSIONS.includes(affinity.expression)) {
        addError(errors, `${affinityBase}.expression`, "invalid_expression", actorIdValue);
      }
      const normalizedExpression = AFFINITY_EXPRESSIONS.includes(affinity.expression)
        ? affinity.expression
        : DEFAULT_AFFINITY_EXPRESSION;
      const targetType = affinity.targetType === undefined
        ? defaultTargetTypeForExpression(normalizedExpression)
        : affinity.targetType;
      if (!AFFINITY_TARGET_TYPES.includes(targetType)) {
        addError(errors, `${affinityBase}.targetType`, "invalid_target_type", actorIdValue);
      }
      if (typeof affinity.presetId !== "string" || affinity.presetId.trim() === "") {
        addError(errors, `${affinityBase}.presetId`, "invalid_preset_id", actorIdValue);
      }
      const stacks = affinity.stacks === undefined ? AFFINITY_DEFAULTS.stacks : affinity.stacks;
      if (!isInteger(stacks) || stacks < 1) {
        addError(errors, `${affinityBase}.stacks`, "invalid_stacks", actorIdValue);
      }
      const preset = presetIndex.get(affinity.presetId);
      if (!preset) {
        addError(errors, `${affinityBase}.presetId`, "unknown_preset", actorIdValue);
      } else {
        if (affinity.kind !== preset.kind) {
          addError(errors, `${affinityBase}.kind`, "mismatched_kind", actorIdValue);
        }
        if (affinity.expression !== preset.expression) {
          addError(errors, `${affinityBase}.expression`, "mismatched_expression", actorIdValue);
        }
        assessAffinityStackTier({
          affinity: { ...affinity, stacks },
          preset,
          path: `${affinityBase}.stacks`,
          actorId: actorIdValue,
        }).forEach((issue) => addError(errors, issue.path, issue.code, issue.actorId));
      }
      return {
        presetId: affinity.presetId,
        kind: affinity.kind,
        expression: normalizedExpression,
        stacks,
        targetType: AFFINITY_TARGET_TYPES.includes(targetType)
          ? targetType
          : defaultTargetTypeForExpression(normalizedExpression),
      };
    });

    loadouts.push({
      actorId: loadout.actorId,
      affinities: affinities.filter(Boolean),
    });

    const requiredExpressions =
      (actorIdValue && requiredExpressionsByActorId && requiredExpressionsByActorId[actorIdValue]) || requiredExpressionsDefault;
    if (Array.isArray(requiredExpressions) && requiredExpressions.length > 0) {
      const present = new Set(affinities.filter(Boolean).map((entry) => entry.expression));
      requiredExpressions.forEach((expression) => {
        if (!present.has(expression)) {
          addError(errors, `${base}.affinities`, "missing_required_expression", actorIdValue);
        }
      });
    }
  });

  const ok = errors.length === 0;
  return { ok, errors, warnings, value: ok ? { loadouts } : null };
}

export { STACK_SCALING };
