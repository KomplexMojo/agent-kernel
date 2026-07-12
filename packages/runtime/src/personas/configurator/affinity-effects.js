import {
  DEFAULT_AFFINITY_EXPRESSION,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";
import {
  normalizeAffinityTargetType,
  resolveAffinityTargetEffectsForEntry,
} from "../moderator/affinity-target-effects.js";
import {
  computeInternalManaUpkeep,
  computeExternalManaUse,
} from "./cost-model.js";

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

/**
 * Compute default hazard vitals based on affinity expression and stacks.
 *
 * For persistent expressions (emit/draw):
 *   - Mana pool: 3x per-tick upkeep (allows running 3 ticks without regen)
 *   - Mana regen: equals per-tick upkeep (sustains indefinitely)
 *   - Durability: 5 per stack (structural integrity)
 *
 * For instantaneous expressions (push/pull):
 *   - Mana pool: 2x mana use (allows 2 activations)
 *   - Mana regen: 0 (one-shot or limited use)
 *   - Durability: 3 per stack
 *
 * @param {string} expression - "push"|"pull"|"emit"|"draw"
 * @param {number} stacks - stack count >= 1
 * @returns {{ mana: { current: number, max: number, regen: number }, durability: { current: number, max: number, regen: number } }}
 */
function computeHazardVitals(expression, stacks) {
  const s = Number.isInteger(stacks) && stacks >= 1 ? stacks : 1;

  if (expression === "emit" || expression === "draw") {
    // Persistent expressions: use internal upkeep formula (2 + s)
    const upkeep = computeInternalManaUpkeep(s);
    const manaPool = upkeep * 3; // 3 ticks worth
    const manaRegen = upkeep; // Sustain indefinitely
    const durability = s * 5; // Structural integrity

    return {
      mana: {
        current: manaPool,
        max: manaPool,
        regen: manaRegen,
      },
      durability: {
        current: durability,
        max: durability,
        regen: 0,
      },
    };
  }

  // Instantaneous expressions (push/pull): use external mana formula (5 + 4·(s-1)²)
  const manaUse = computeExternalManaUse(s);
  const manaPool = manaUse * 2; // 2 activations worth
  const durability = s * 3;

  return {
    mana: {
      current: manaPool,
      max: manaPool,
      regen: 0, // No regen for instantaneous
    },
    durability: {
      current: durability,
      max: durability,
      regen: 0,
    },
  };
}

function selectPresetForHazard(hazard, presets) {
  const matches = presets.filter((preset) => preset.kind === hazard.affinity.kind && preset.expression === hazard.affinity.expression);
  if (matches.length === 0) return null;
  return matches.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
}

function resolveHazardEffects(hazard, presets) {
  // Start with provided vitals, or compute defaults based on expression + stacks
  let baseVitals;
  if (hazard.vitals && (hazard.vitals.mana || hazard.vitals.durability || hazard.vitals.health || hazard.vitals.stamina)) {
    baseVitals = ensureVitals(hazard.vitals);
  } else {
    // No vitals provided: compute defaults from expression and stacks
    const computed = computeHazardVitals(hazard.affinity.expression, hazard.affinity.stacks);
    baseVitals = ensureVitals(computed);
  }

  const abilities = [];
  const affinityStacks = {};
  const affinityTargets = {};
  const expression = hazard.affinity.expression;
  const hazardTargetType = hazard.affinity.targetType || "floor";
  const targetType = normalizeAffinityTargetType(
    hazardTargetType,
    expression || DEFAULT_AFFINITY_EXPRESSION,
  );
  addAffinityStack(affinityStacks, hazard.affinity.kind, expression, hazard.affinity.stacks);
  addAffinityTargetStack(affinityTargets, hazard.affinity.kind, expression, targetType, hazard.affinity.stacks);

  const preset = selectPresetForHazard(hazard, presets);
  if (preset) {
    const allowHealth = preset.kind === "life" || preset.kind === "decay";
    const updatedVitals = applyPresetToVitals(baseVitals, preset, hazard.affinity.stacks, {
      health: allowHealth,
      stamina: false,
    });
    VITAL_KEYS.forEach((key) => {
      baseVitals[key] = updatedVitals[key];
    });
    const presetAbilities = resolvePresetAbilities(preset);
    presetAbilities.forEach((ability) => {
      abilities.push(resolveAbility(ability, preset, hazard.affinity.stacks));
    });
  }

  const resolvedEffects = resolveAffinityTargetEffectsForEntry(
    {
      kind: hazard.affinity.kind,
      expression,
      stacks: hazard.affinity.stacks,
      targetType,
    },
    {
      sourceType: "hazard",
      sourceId: `${hazard.x},${hazard.y}`,
      manaReserve: baseVitals?.mana?.current || 0,
    },
  );
  resolvedEffects.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  return {
    position: { x: hazard.x, y: hazard.y },
    vitals: baseVitals,
    abilities,
    affinityStacks,
    affinityTargets,
    resolvedEffects,
  };
}

export function resolveAffinityEffects({ presets = [], loadouts = [], baseVitalsByActorId = {}, hazards = [] } = {}) {
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

  const hazardResults = (Array.isArray(hazards) ? hazards : [])
    .map((hazard) => resolveHazardEffects(hazard, presets))
    .sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));

  return { actors, hazards: hazardResults };
}
