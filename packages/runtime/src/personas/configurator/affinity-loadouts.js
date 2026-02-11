import { AFFINITY_DEFAULTS } from "./defaults.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";

export { AFFINITY_KINDS, AFFINITY_EXPRESSIONS };
const ABILITY_KINDS = Object.freeze(["attack", "buff", "area"]);
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

function normalizeEffect(effect, fieldBase, errors) {
  if (!isPlainObject(effect)) {
    addError(errors, fieldBase, "invalid_effect");
    return null;
  }
  if (typeof effect.id !== "string" || effect.id.trim() === "") {
    addError(errors, `${fieldBase}.id`, "invalid_effect_id");
  }
  if (!isNumber(effect.potency) || effect.potency < 0) {
    addError(errors, `${fieldBase}.potency`, "invalid_effect_potency");
  }
  return {
    id: effect.id,
    potency: effect.potency,
  };
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

function normalizeAbility(ability, fieldBase, errors, preset) {
  if (!isPlainObject(ability)) {
    addError(errors, fieldBase, "invalid_ability");
    return null;
  }
  if (typeof ability.id !== "string" || ability.id.trim() === "") {
    addError(errors, `${fieldBase}.id`, "invalid_ability_id");
  }
  if (!ABILITY_KINDS.includes(ability.kind)) {
    addError(errors, `${fieldBase}.kind`, "invalid_ability_kind");
  }
  if (!AFFINITY_KINDS.includes(ability.affinityKind)) {
    addError(errors, `${fieldBase}.affinityKind`, "invalid_kind");
  }
  if (preset && ability.affinityKind && ability.affinityKind !== preset.kind) {
    addError(errors, `${fieldBase}.affinityKind`, "mismatched_kind");
  }
  if (!isNumber(ability.potency)) {
    addError(errors, `${fieldBase}.potency`, "invalid_potency");
  }
  if (ability.manaCost !== undefined && (!isNumber(ability.manaCost) || ability.manaCost < 0 || !isInteger(ability.manaCost))) {
    addError(errors, `${fieldBase}.manaCost`, "invalid_mana_cost");
  }
  if (ability.expression !== undefined && !AFFINITY_EXPRESSIONS.includes(ability.expression)) {
    addError(errors, `${fieldBase}.expression`, "invalid_expression");
  }
  if (preset && ability.expression && ability.expression !== preset.expression) {
    addError(errors, `${fieldBase}.expression`, "mismatched_expression");
  }
  return {
    id: ability.id,
    kind: ability.kind,
    affinityKind: ability.affinityKind,
    potency: ability.potency,
    manaCost: ability.manaCost,
    expression: ability.expression,
  };
}

function hasAbilityKind(abilities, kind) {
  if (!Array.isArray(abilities)) return false;
  return abilities.some((ability) => ability?.kind === kind);
}

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

    if (!isPlainObject(preset.effects)) {
      addError(errors, `${base}.effects`, "invalid_effects");
    } else {
      if (preset.effects.attack) {
        normalizeEffect(preset.effects.attack, `${base}.effects.attack`, errors);
      }
      if (preset.effects.buff) {
        normalizeEffect(preset.effects.buff, `${base}.effects.buff`, errors);
      }
      if (preset.effects.area) {
        normalizeEffect(preset.effects.area, `${base}.effects.area`, errors);
      }
    }

    const abilitiesInput = preset.abilities;
    const abilities = [];
    if (abilitiesInput !== undefined) {
      if (!Array.isArray(abilitiesInput)) {
        addError(errors, `${base}.abilities`, "invalid_list");
      } else {
        abilitiesInput.forEach((ability, abilityIndex) => {
          const abilityBase = `${base}.abilities[${abilityIndex}]`;
          const normalized = normalizeAbility(ability, abilityBase, errors, preset);
          if (normalized) abilities.push(normalized);
        });
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

    if (preset.expression === "push") {
      if (!preset.effects?.attack && !hasAbilityKind(abilities, "attack")) {
        addError(errors, `${base}.effects.attack`, "missing_attack_effect");
      }
    }
    if (preset.expression === "pull") {
      if (!preset.effects?.buff && !hasAbilityKind(abilities, "buff")) {
        addError(errors, `${base}.effects.buff`, "missing_buff_effect");
      }
    }
    if (preset.expression === "emit") {
      if (!preset.effects?.area && !hasAbilityKind(abilities, "area")) {
        addError(errors, `${base}.effects.area`, "missing_area_effect");
      }
    }

    presets.push({
      id: preset.id,
      kind: preset.kind,
      expression: preset.expression,
      manaCost,
      effects: preset.effects,
      vitalsModifiers: preset.vitalsModifiers,
      abilities: abilities.length > 0 ? abilities : undefined,
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
        if (isInteger(stacks) && isInteger(preset.stack?.max) && stacks > preset.stack.max) {
          addError(errors, `${affinityBase}.stacks`, "stacks_exceed_max", actorIdValue);
        }
      }
      return {
        presetId: affinity.presetId,
        kind: affinity.kind,
        expression: affinity.expression,
        stacks,
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
