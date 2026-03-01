import {
  DEFAULT_AFFINITY_EXPRESSION,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";
import {
  normalizeAffinityTargetType,
  resolveAffinityTargetEffectsForEntry,
} from "../moderator/affinity-target-effects.js";

function isNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

function ensureVitalRecord(record) {
  return {
    current: isNumber(record?.current) ? record.current : 0,
    max: isNumber(record?.max) ? record.max : 0,
    regen: isNumber(record?.regen) ? record.regen : 0,
  };
}

function ensureVitals(vitals = {}) {
  return VITAL_KEYS.reduce((acc, key) => {
    acc[key] = ensureVitalRecord(vitals[key]);
    return acc;
  }, {});
}

function scaleValue(value, stacks, scaling) {
  const base = isNumber(value) ? value : 0;
  const count = Number.isInteger(stacks) && stacks > 0 ? stacks : 1;
  if (count === 1) return base;
  if (scaling === "multiplier") {
    return base * Math.pow(2, count - 1);
  }
  return base * count;
}

function applyVitalModifier(vital, modifier, stacks, scaling) {
  if (!modifier) return vital;
  return {
    current: vital.current + scaleValue(modifier.current, stacks, scaling),
    max: vital.max + scaleValue(modifier.max, stacks, scaling),
    regen: vital.regen + scaleValue(modifier.regen, stacks, scaling),
  };
}

function sortedById(list) {
  if (!Array.isArray(list)) return [];
  return list.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
}

function deriveAbilitiesFromEffects(preset) {
  const effects = preset.effects || {};
  const abilities = [];
  if (effects.attack) {
    abilities.push({ id: effects.attack.id, kind: "attack", potency: effects.attack.potency });
  }
  if (effects.buff) {
    abilities.push({ id: effects.buff.id, kind: "buff", potency: effects.buff.potency });
  }
  if (effects.area) {
    abilities.push({ id: effects.area.id, kind: "area", potency: effects.area.potency });
  }
  return abilities;
}

function resolvePresetAbilities(preset) {
  if (Array.isArray(preset.abilities) && preset.abilities.length > 0) {
    return sortedById(preset.abilities);
  }
  return sortedById(deriveAbilitiesFromEffects(preset));
}

function resolveAbility(ability, preset, stacks) {
  const scaling = preset.stack?.scaling || "linear";
  const baseManaCost = ability.manaCost ?? preset.manaCost ?? 0;
  const expression = ability.expression || preset.expression;
  return {
    id: ability.id,
    kind: ability.kind,
    affinityKind: ability.affinityKind || preset.kind,
    expression,
    targetType: normalizeAffinityTargetType(ability.targetType, expression),
    potency: scaleValue(ability.potency, stacks, scaling),
    manaCost: scaleValue(baseManaCost, stacks, scaling),
  };
}

function addAffinityStack(map, kind, expression, stacks) {
  const key = `${kind}:${expression}`;
  const current = map[key];
  const value = Number.isInteger(stacks) ? stacks : 1;
  map[key] = current === undefined ? value : current + value;
}

function addAffinityTargetStack(map, kind, expression, targetType, stacks) {
  const key = `${kind}:${expression}:${targetType}`;
  const current = map[key];
  const value = Number.isInteger(stacks) ? stacks : 1;
  map[key] = current === undefined ? value : current + value;
}

function applyPresetToVitals(vitals, preset, stacks, allowByVital = {}) {
  const modifiers = preset.vitalsModifiers;
  if (!modifiers) return vitals;
  const scaling = preset.stack?.scaling || "linear";
  const next = { ...vitals };
  VITAL_KEYS.forEach((key) => {
    if (allowByVital[key] === false) return;
    if (modifiers[key]) {
      next[key] = applyVitalModifier(next[key], modifiers[key], stacks, scaling);
    }
  });
  return next;
}

function resolveActorEffects(loadout, presetIndex, baseVitals) {
  const vitals = ensureVitals(baseVitals);
  const abilities = [];
  const affinityStacks = {};
  const affinityTargets = {};
  const resolvedEffects = [];

  loadout.affinities.forEach((affinity) => {
    const preset = presetIndex.get(affinity.presetId);
    if (!preset) return;
    const stacks = affinity.stacks || 1;
    const updatedVitals = applyPresetToVitals(vitals, preset, stacks);
    VITAL_KEYS.forEach((key) => {
      vitals[key] = updatedVitals[key];
    });
    addAffinityStack(affinityStacks, preset.kind, preset.expression, stacks);
    const targetType = normalizeAffinityTargetType(
      affinity.targetType,
      preset.expression || DEFAULT_AFFINITY_EXPRESSION,
    );
    addAffinityTargetStack(affinityTargets, preset.kind, preset.expression, targetType, stacks);
    resolvedEffects.push(
      ...resolveAffinityTargetEffectsForEntry(
        { kind: preset.kind, expression: preset.expression, stacks, targetType },
        {
          sourceType: "actor",
          sourceId: loadout.actorId,
          manaReserve: vitals?.mana?.current || 0,
        },
      ),
    );

    const presetAbilities = resolvePresetAbilities(preset);
    presetAbilities.forEach((ability) => {
      abilities.push(resolveAbility(ability, preset, stacks));
    });
  });

  resolvedEffects.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  return { vitals, abilities, affinityStacks, affinityTargets, resolvedEffects };
}

function selectPresetForTrap(trap, presets) {
  const matches = presets.filter((preset) => preset.kind === trap.affinity.kind && preset.expression === trap.affinity.expression);
  if (matches.length === 0) return null;
  return matches.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
}

function resolveTrapEffects(trap, presets) {
  const baseVitals = ensureVitals(trap.vitals || {});
  const abilities = [];
  const affinityStacks = {};
  const affinityTargets = {};
  const expression = trap.affinity.expression;
  const trapTargetType = trap.affinity.targetType || "floor";
  const targetType = normalizeAffinityTargetType(
    trapTargetType,
    expression || DEFAULT_AFFINITY_EXPRESSION,
  );
  addAffinityStack(affinityStacks, trap.affinity.kind, expression, trap.affinity.stacks);
  addAffinityTargetStack(affinityTargets, trap.affinity.kind, expression, targetType, trap.affinity.stacks);

  const preset = selectPresetForTrap(trap, presets);
  if (preset) {
    const allowHealth = preset.kind === "life" || preset.kind === "decay";
    const updatedVitals = applyPresetToVitals(baseVitals, preset, trap.affinity.stacks, {
      health: allowHealth,
      stamina: false,
    });
    VITAL_KEYS.forEach((key) => {
      baseVitals[key] = updatedVitals[key];
    });
    const presetAbilities = resolvePresetAbilities(preset);
    presetAbilities.forEach((ability) => {
      abilities.push(resolveAbility(ability, preset, trap.affinity.stacks));
    });
  }

  const resolvedEffects = resolveAffinityTargetEffectsForEntry(
    {
      kind: trap.affinity.kind,
      expression,
      stacks: trap.affinity.stacks,
      targetType,
    },
    {
      sourceType: "trap",
      sourceId: `${trap.x},${trap.y}`,
      manaReserve: baseVitals?.mana?.current || 0,
    },
  );
  resolvedEffects.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  return {
    position: { x: trap.x, y: trap.y },
    vitals: baseVitals,
    abilities,
    affinityStacks,
    affinityTargets,
    resolvedEffects,
  };
}

export function resolveAffinityEffects({ presets = [], loadouts = [], baseVitalsByActorId = {}, traps = [] } = {}) {
  const presetIndex = new Map();
  presets.forEach((preset) => {
    if (preset && preset.id) {
      presetIndex.set(preset.id, preset);
    }
  });

  const actors = loadouts
    .map((loadout) => {
      const baseVitals = baseVitalsByActorId?.[loadout.actorId] || {};
      const resolved = resolveActorEffects(loadout, presetIndex, baseVitals);
      return {
        actorId: loadout.actorId,
        vitals: resolved.vitals,
        abilities: resolved.abilities,
        affinityStacks: resolved.affinityStacks,
        affinityTargets: resolved.affinityTargets,
        resolvedEffects: resolved.resolvedEffects,
      };
    })
    .sort((a, b) => String(a.actorId).localeCompare(String(b.actorId)));

  const trapResults = (Array.isArray(traps) ? traps : [])
    .map((trap) => resolveTrapEffects(trap, presets))
    .sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));

  return { actors, traps: trapResults };
}
