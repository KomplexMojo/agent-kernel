import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_OPPOSITES,
  AFFINITY_TARGET_TYPES,
  DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";
import { BEHAVIOR_COMPLEXITY_CLASSES } from "./motivation-rules.js";
import {
  normalizeFixedPositionWorldActorCostProfile,
  normalizeTrapArchetypeRules,
} from "./cost-model.js";

const OUTCOME_TYPES = Object.freeze([
  "cancel",
  "suppress",
  "convert",
  "amplify",
  "mutate_environment",
  "apply_status",
  "reflect",
]);
const SPEND_POLICIES = Object.freeze(["full", "none", "half"]);
const ALLOWED_TIERS = Object.freeze([1, 2, 3, 4, 5]);
const DEFAULT_AFFINITY_COMPLEXITY_BY_TIER = Object.freeze({
  1: "instinctual",
  2: "tactical",
  3: "tactical",
  4: "strategic",
  5: "strategic",
});
const INTERACTION_CHANNELS = Object.freeze(["field", "projected"]);
const INTERACTION_POLARITIES = Object.freeze(["outward", "inward"]);
const RANGE_SHAPES = Object.freeze(["self", "adjacent", "line", "radius"]);
const ROOM_AFFINITY_MODES = Object.freeze(["optional", "canonical"]);
const INTERACTION_EXAMPLE_KINDS = Object.freeze(["ambient", "projected"]);
const DEFAULT_EXPRESSION_SEMANTICS = Object.freeze({
  push: Object.freeze({
    channel: "projected",
    polarity: "outward",
    rangeBehavior: Object.freeze({ shape: "line", minTiles: 1, maxTiles: 4 }),
    oppositeAffinityOutcome: "suppress",
    vitalPressure: Object.freeze({ health: 1 }),
  }),
  pull: Object.freeze({
    channel: "projected",
    polarity: "inward",
    rangeBehavior: Object.freeze({ shape: "line", minTiles: 1, maxTiles: 3 }),
    oppositeAffinityOutcome: "suppress",
    vitalPressure: Object.freeze({ health: 1 }),
  }),
  emit: Object.freeze({
    channel: "field",
    polarity: "outward",
    rangeBehavior: Object.freeze({ shape: "radius", minTiles: 0, maxTiles: 2 }),
    oppositeAffinityOutcome: "cancel",
    vitalPressure: Object.freeze({ health: 1 }),
  }),
  draw: Object.freeze({
    channel: "field",
    polarity: "inward",
    rangeBehavior: Object.freeze({ shape: "radius", minTiles: 0, maxTiles: 2 }),
    oppositeAffinityOutcome: "cancel",
    vitalPressure: Object.freeze({ mana: 1 }),
  }),
});
const DEFAULT_CLOSE_PROXIMITY_NEGATION = Object.freeze({
  enabled: true,
  radiusTiles: 1,
  appliesToChannels: Object.freeze(["field"]),
});
const DEFAULT_INTERACTION_CONTRACT = Object.freeze({
  expressionSemantics: Object.freeze(cloneJson(DEFAULT_EXPRESSION_SEMANTICS)),
  closeProximityNegation: Object.freeze(cloneJson(DEFAULT_CLOSE_PROXIMITY_NEGATION)),
  interactionExamples: Object.freeze([
    Object.freeze({
      id: "ambient_fire_vs_water",
      kind: "ambient",
      sourceKind: "fire",
      sourceExpression: "emit",
      targetKind: "water",
      targetExpression: "emit",
      expectedOutcome: "cancel",
    }),
    Object.freeze({
      id: "ambient_light_vs_dark",
      kind: "ambient",
      sourceKind: "light",
      sourceExpression: "emit",
      targetKind: "dark",
      targetExpression: "emit",
      expectedOutcome: "cancel",
    }),
    Object.freeze({
      id: "projected_fire_push_vs_water_pull",
      kind: "projected",
      sourceKind: "fire",
      sourceExpression: "push",
      targetKind: "water",
      targetExpression: "pull",
      expectedOutcome: "suppress",
    }),
  ]),
});
const DEFAULT_WORLD_ACTOR_COST_MODEL = Object.freeze({
  roomWideAffinityMode: "optional",
  fixedPositionNeutralProfile: Object.freeze({
    id: "neutral_floor_or_barrier_atom",
    kind: "floor",
    stationary: true,
    neutralBaseline: true,
    tokenCost: 1,
    vitals: Object.freeze({
      health: 0,
      mana: 0,
      stamina: 0,
      durability: 0,
    }),
    regen: Object.freeze({
      health: 0,
      mana: 0,
      stamina: 0,
    }),
  }),
  stationaryManaPolicy: Object.freeze({
    poweredEffectRequiresPositiveReserve: true,
    allowZeroReserveAffinityState: true,
    regenOptional: true,
  }),
  trapArchetype: Object.freeze({
    roomBounded: true,
    attackingOnly: true,
    maxAffinityCount: 1,
    maxExpressionCount: 1,
    stacksAllowed: true,
    manaReserveRequired: true,
    manaRegenOptional: true,
    allowedExpressions: Object.freeze([...AFFINITY_EXPRESSIONS]),
    highInvestmentProfile: Object.freeze({
      label: "central_decay_focus",
      tokenCost: 125,
      kind: "decay",
      expression: "emit",
      stacks: 5,
      manaReserve: 30,
      manaRegen: 0,
    }),
  }),
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && !Number.isNaN(value) && value >= 0;
}

function addError(errors, field, code) {
  errors.push({ field, code });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTargetType(targetType, verb) {
  if (AFFINITY_TARGET_TYPES.includes(targetType)) {
    return targetType;
  }
  return DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION[verb];
}

function normalizeManaScaling(input = {}, fieldBase, errors) {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_mana_scaling");
    return undefined;
  }
  const output = {};
  [
    "areaSizeMultiplier",
    "targetCountMultiplier",
    "durationMultiplier",
    "persistentAreaSurcharge",
    "environmentMutationSurcharge",
    "overrideAffinitySurcharge",
  ].forEach((key) => {
    if (input[key] === undefined) return;
    if (!isNonNegativeNumber(input[key])) {
      addError(errors, `${fieldBase}.${key}`, "invalid_non_negative_number");
      return;
    }
    output[key] = input[key];
  });
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeStackTiers(stackTiers, fieldBase, errors) {
  if (!Array.isArray(stackTiers)) {
    addError(errors, fieldBase, "invalid_list");
    return [];
  }
  const seen = new Set();
  const tiers = stackTiers.map((tierEntry, index) => {
    const tierBase = `${fieldBase}[${index}]`;
    if (!isPlainObject(tierEntry)) {
      addError(errors, tierBase, "invalid_tier");
      return null;
    }
    if (!ALLOWED_TIERS.includes(tierEntry.tier)) {
      addError(errors, `${tierBase}.tier`, "invalid_tier_value");
    } else if (seen.has(tierEntry.tier)) {
      addError(errors, `${tierBase}.tier`, "duplicate_tier");
    } else {
      seen.add(tierEntry.tier);
    }
    if (!Number.isInteger(tierEntry.manaCost) || tierEntry.manaCost < 0) {
      addError(errors, `${tierBase}.manaCost`, "invalid_mana_cost");
    }
    if (tierEntry.potency !== undefined && !isNonNegativeNumber(tierEntry.potency)) {
      addError(errors, `${tierBase}.potency`, "invalid_non_negative_number");
    }
    if (tierEntry.defaultDesignCostTokens !== undefined && !Number.isInteger(tierEntry.defaultDesignCostTokens)) {
      addError(errors, `${tierBase}.defaultDesignCostTokens`, "invalid_non_negative_int");
    }
    if (tierEntry.defaultDesignCostTokens !== undefined && tierEntry.defaultDesignCostTokens < 0) {
      addError(errors, `${tierBase}.defaultDesignCostTokens`, "invalid_non_negative_int");
    }
    if (tierEntry.complexityClass !== undefined && !BEHAVIOR_COMPLEXITY_CLASSES.includes(tierEntry.complexityClass)) {
      addError(errors, `${tierBase}.complexityClass`, "invalid_complexity_class");
    }
    if (tierEntry.unlockedEffects !== undefined && !Array.isArray(tierEntry.unlockedEffects)) {
      addError(errors, `${tierBase}.unlockedEffects`, "invalid_list");
    }
    return {
      tier: tierEntry.tier,
      manaCost: tierEntry.manaCost,
      potency: tierEntry.potency,
      defaultDesignCostTokens: Number.isInteger(tierEntry.defaultDesignCostTokens) ? tierEntry.defaultDesignCostTokens : undefined,
      complexityClass: BEHAVIOR_COMPLEXITY_CLASSES.includes(tierEntry.complexityClass) ? tierEntry.complexityClass : undefined,
      unlockedEffects: Array.isArray(tierEntry.unlockedEffects) ? tierEntry.unlockedEffects.filter(isNonEmptyString) : undefined,
    };
  }).filter(Boolean).sort((a, b) => a.tier - b.tier);

  ALLOWED_TIERS.forEach((tier) => {
    if (!seen.has(tier)) {
      addError(errors, fieldBase, `missing_tier_${tier}`);
    }
  });

  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i].manaCost < tiers[i - 1].manaCost) {
      addError(errors, `${fieldBase}[${i}].manaCost`, "decreasing_mana_cost");
    }
  }

  return tiers;
}

function normalizeExpression(expression, fieldBase, errors) {
  if (!isPlainObject(expression)) {
    addError(errors, fieldBase, "invalid_expression_rule");
    return null;
  }
  if (!isNonEmptyString(expression.id)) {
    addError(errors, `${fieldBase}.id`, "invalid_id");
  }
  if (!AFFINITY_EXPRESSIONS.includes(expression.verb)) {
    addError(errors, `${fieldBase}.verb`, "invalid_expression");
  }
  return {
    id: expression.id,
    label: isNonEmptyString(expression.label) ? expression.label.trim() : undefined,
    verb: expression.verb,
    defaultTargetType: normalizeTargetType(expression.defaultTargetType, expression.verb),
    stackTiers: normalizeStackTiers(expression.stackTiers, `${fieldBase}.stackTiers`, errors),
    manaScaling: normalizeManaScaling(expression.manaScaling, `${fieldBase}.manaScaling`, errors),
  };
}

function normalizeAffinity(affinity, fieldBase, errors) {
  if (!isPlainObject(affinity)) {
    addError(errors, fieldBase, "invalid_affinity_rule");
    return null;
  }
  if (!AFFINITY_KINDS.includes(affinity.kind)) {
    addError(errors, `${fieldBase}.kind`, "invalid_kind");
  }
  if (!AFFINITY_KINDS.includes(affinity.opposite)) {
    addError(errors, `${fieldBase}.opposite`, "invalid_opposite");
  }
  if (affinity.kind && affinity.opposite && AFFINITY_OPPOSITES[affinity.kind] !== affinity.opposite) {
    addError(errors, `${fieldBase}.opposite`, "mismatched_opposite");
  }
  if (affinity.basePriority !== undefined && !Number.isInteger(affinity.basePriority)) {
    addError(errors, `${fieldBase}.basePriority`, "invalid_priority");
  }
  if (!Array.isArray(affinity.expressions) || affinity.expressions.length === 0) {
    addError(errors, `${fieldBase}.expressions`, "invalid_list");
    return null;
  }

  const expressions = affinity.expressions
    .map((entry, index) => normalizeExpression(entry, `${fieldBase}.expressions[${index}]`, errors))
    .filter(Boolean);

  const expressionIds = new Set();
  const expressionVerbs = new Set();
  expressions.forEach((expression, index) => {
    if (expressionIds.has(expression.id)) {
      addError(errors, `${fieldBase}.expressions[${index}].id`, "duplicate_expression_id");
    }
    expressionIds.add(expression.id);
    if (expressionVerbs.has(expression.verb)) {
      addError(errors, `${fieldBase}.expressions[${index}].verb`, "duplicate_expression_verb");
    }
    expressionVerbs.add(expression.verb);
  });

  return {
    kind: affinity.kind,
    opposite: affinity.opposite,
    basePriority: affinity.basePriority ?? 0,
    expressions,
  };
}

function normalizeManaPolicy(input = {}, fieldBase, errors) {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_mana_rule");
    return undefined;
  }
  const output = {};
  ["winnerSpend", "loserSpend", "tieSpend"].forEach((key) => {
    if (input[key] === undefined) return;
    if (!SPEND_POLICIES.includes(input[key])) {
      addError(errors, `${fieldBase}.${key}`, "invalid_spend_policy");
      return;
    }
    output[key] = input[key];
  });
  ["refundPercent", "clashCost", "overpowerBonusCost", "drainOnFail"].forEach((key) => {
    if (input[key] === undefined) return;
    if (!isNonNegativeNumber(input[key])) {
      addError(errors, `${fieldBase}.${key}`, "invalid_non_negative_number");
      return;
    }
    output[key] = input[key];
  });
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeInteraction(interaction, fieldBase, errors) {
  if (!isPlainObject(interaction)) {
    addError(errors, fieldBase, "invalid_interaction");
    return null;
  }
  if (!AFFINITY_KINDS.includes(interaction.sourceKind)) {
    addError(errors, `${fieldBase}.sourceKind`, "invalid_kind");
  }
  if (!AFFINITY_KINDS.includes(interaction.targetKind)) {
    addError(errors, `${fieldBase}.targetKind`, "invalid_kind");
  }
  ["outcomeOnSourceWin", "outcomeOnTargetWin", "outcomeOnTie"].forEach((key) => {
    if (interaction[key] === undefined) return;
    if (!OUTCOME_TYPES.includes(interaction[key])) {
      addError(errors, `${fieldBase}.${key}`, "invalid_outcome");
    }
  });
  return {
    sourceKind: interaction.sourceKind,
    targetKind: interaction.targetKind,
    outcomeOnSourceWin: interaction.outcomeOnSourceWin,
    outcomeOnTargetWin: interaction.outcomeOnTargetWin,
    outcomeOnTie: interaction.outcomeOnTie,
    mana: normalizeManaPolicy(interaction.mana, `${fieldBase}.mana`, errors),
  };
}

function normalizeDrawConversionRule(input = {}, fieldBase, errors) {
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_draw_conversion_rule");
    return undefined;
  }
  const output = {};
  if (input.targetVital !== undefined) {
    if (!VITAL_KEYS.includes(input.targetVital)) {
      addError(errors, `${fieldBase}.targetVital`, "invalid_target_vital");
    } else {
      output.targetVital = input.targetVital;
    }
  }
  if (input.efficiency !== undefined) {
    if (!isNonNegativeNumber(input.efficiency)) {
      addError(errors, `${fieldBase}.efficiency`, "invalid_non_negative_number");
    } else {
      output.efficiency = input.efficiency;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeDrawConversion(input = {}, fieldBase, errors) {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_draw_conversion");
    return undefined;
  }
  const output = {};
  const defaultRule = normalizeDrawConversionRule(input.defaultRule, `${fieldBase}.defaultRule`, errors);
  if (defaultRule) {
    output.defaultRule = defaultRule;
  }
  if (input.byAffinity !== undefined) {
    if (!isPlainObject(input.byAffinity)) {
      addError(errors, `${fieldBase}.byAffinity`, "invalid_by_affinity");
    } else {
      const byAffinity = {};
      Object.entries(input.byAffinity).forEach(([kind, rule]) => {
        if (!AFFINITY_KINDS.includes(kind)) {
          addError(errors, `${fieldBase}.byAffinity.${kind}`, "invalid_kind");
          return;
        }
        const normalized = normalizeDrawConversionRule(rule, `${fieldBase}.byAffinity.${kind}`, errors);
        if (normalized) {
          byAffinity[kind] = normalized;
        }
      });
      if (Object.keys(byAffinity).length > 0) {
        output.byAffinity = byAffinity;
      }
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeRangeBehavior(input = {}, fieldBase, errors, defaults = {}) {
  if (input === undefined) {
    return cloneJson(defaults);
  }
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_range_behavior");
    return cloneJson(defaults);
  }
  const shape = RANGE_SHAPES.includes(input.shape) ? input.shape : defaults.shape;
  if (input.shape !== undefined && !RANGE_SHAPES.includes(input.shape)) {
    addError(errors, `${fieldBase}.shape`, "invalid_range_shape");
  }
  const minTiles = Number.isInteger(input.minTiles) && input.minTiles >= 0 ? input.minTiles : defaults.minTiles;
  if (input.minTiles !== undefined && (!Number.isInteger(input.minTiles) || input.minTiles < 0)) {
    addError(errors, `${fieldBase}.minTiles`, "invalid_non_negative_int");
  }
  const maxTiles = Number.isInteger(input.maxTiles) && input.maxTiles >= 0 ? input.maxTiles : defaults.maxTiles;
  if (input.maxTiles !== undefined && (!Number.isInteger(input.maxTiles) || input.maxTiles < 0)) {
    addError(errors, `${fieldBase}.maxTiles`, "invalid_non_negative_int");
  }
  if (Number.isInteger(minTiles) && Number.isInteger(maxTiles) && maxTiles < minTiles) {
    addError(errors, `${fieldBase}.maxTiles`, "range_max_below_min");
  }
  return {
    shape,
    minTiles,
    maxTiles,
  };
}

function normalizeVitalPressure(input = {}, fieldBase, errors, defaults = {}) {
  if (input === undefined) return cloneJson(defaults);
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_vital_pressure");
    return cloneJson(defaults);
  }
  const vitalPressure = {};
  VITAL_KEYS.forEach((key) => {
    const value = input[key];
    if (value === undefined) {
      if (defaults[key] !== undefined) {
        vitalPressure[key] = defaults[key];
      }
      return;
    }
    if (!isNonNegativeNumber(value)) {
      addError(errors, `${fieldBase}.${key}`, "invalid_non_negative_number");
      return;
    }
    vitalPressure[key] = value;
  });
  return vitalPressure;
}

function normalizeExpressionSemanticsEntry(input, expression, fieldBase, errors) {
  const defaults = DEFAULT_EXPRESSION_SEMANTICS[expression] || {};
  if (input === undefined) {
    return cloneJson(defaults);
  }
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_expression_semantics");
    return cloneJson(defaults);
  }
  const channel = INTERACTION_CHANNELS.includes(input.channel)
    ? input.channel
    : (input.channel === "spatial" ? "projected" : defaults.channel);
  if (input.channel !== undefined && !INTERACTION_CHANNELS.includes(input.channel) && input.channel !== "spatial") {
    addError(errors, `${fieldBase}.channel`, "invalid_channel");
  }
  const polarity = INTERACTION_POLARITIES.includes(input.polarity) ? input.polarity : defaults.polarity;
  if (input.polarity !== undefined && !INTERACTION_POLARITIES.includes(input.polarity)) {
    addError(errors, `${fieldBase}.polarity`, "invalid_polarity");
  }
  const rangeBehavior = normalizeRangeBehavior(
    input.rangeBehavior,
    `${fieldBase}.rangeBehavior`,
    errors,
    defaults.rangeBehavior || {},
  );
  const oppositeAffinityOutcome = OUTCOME_TYPES.includes(input.oppositeAffinityOutcome)
    ? input.oppositeAffinityOutcome
    : defaults.oppositeAffinityOutcome;
  if (input.oppositeAffinityOutcome !== undefined && !OUTCOME_TYPES.includes(input.oppositeAffinityOutcome)) {
    addError(errors, `${fieldBase}.oppositeAffinityOutcome`, "invalid_outcome");
  }
  const vitalPressure = normalizeVitalPressure(
    input.vitalPressure,
    `${fieldBase}.vitalPressure`,
    errors,
    defaults.vitalPressure || {},
  );
  return {
    channel,
    polarity,
    rangeBehavior,
    oppositeAffinityOutcome,
    vitalPressure,
  };
}

function normalizeExpressionSemanticsMap(input, fieldBase, errors) {
  const source = input === undefined ? DEFAULT_EXPRESSION_SEMANTICS : input;
  if (!isPlainObject(source)) {
    addError(errors, fieldBase, "invalid_expression_semantics_map");
    return cloneJson(DEFAULT_EXPRESSION_SEMANTICS);
  }
  const semantics = {};
  AFFINITY_EXPRESSIONS.forEach((expression) => {
    semantics[expression] = normalizeExpressionSemanticsEntry(
      source[expression],
      expression,
      `${fieldBase}.${expression}`,
      errors,
    );
  });
  return semantics;
}

function normalizeCloseProximityNegation(input = {}, fieldBase, errors) {
  if (input === undefined) {
    return cloneJson(DEFAULT_CLOSE_PROXIMITY_NEGATION);
  }
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_close_proximity_negation");
    return cloneJson(DEFAULT_CLOSE_PROXIMITY_NEGATION);
  }
  const enabled = input.enabled === undefined ? true : input.enabled === true;
  const radiusTiles = Number.isInteger(input.radiusTiles) && input.radiusTiles >= 0
    ? input.radiusTiles
    : DEFAULT_CLOSE_PROXIMITY_NEGATION.radiusTiles;
  if (input.radiusTiles !== undefined && (!Number.isInteger(input.radiusTiles) || input.radiusTiles < 0)) {
    addError(errors, `${fieldBase}.radiusTiles`, "invalid_non_negative_int");
  }
  const channelInput = Array.isArray(input.appliesToChannels)
    ? input.appliesToChannels
    : DEFAULT_CLOSE_PROXIMITY_NEGATION.appliesToChannels;
  const appliesToChannels = channelInput
    .map((entry) => String(entry || "").trim())
    .filter((entry) => INTERACTION_CHANNELS.includes(entry));
  if (appliesToChannels.length === 0) {
    addError(errors, `${fieldBase}.appliesToChannels`, "invalid_channel_list");
  }
  return {
    enabled,
    radiusTiles,
    appliesToChannels,
  };
}

function normalizeInteractionExample(input = {}, fieldBase, errors) {
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_interaction_example");
    return null;
  }
  const id = isNonEmptyString(input.id) ? input.id.trim() : "";
  if (!id) {
    addError(errors, `${fieldBase}.id`, "invalid_id");
  }
  const kind = INTERACTION_EXAMPLE_KINDS.includes(input.kind) ? input.kind : "ambient";
  if (input.kind !== undefined && !INTERACTION_EXAMPLE_KINDS.includes(input.kind)) {
    addError(errors, `${fieldBase}.kind`, "invalid_example_kind");
  }
  if (!AFFINITY_KINDS.includes(input.sourceKind)) {
    addError(errors, `${fieldBase}.sourceKind`, "invalid_kind");
  }
  if (!AFFINITY_KINDS.includes(input.targetKind)) {
    addError(errors, `${fieldBase}.targetKind`, "invalid_kind");
  }
  if (!AFFINITY_EXPRESSIONS.includes(input.sourceExpression)) {
    addError(errors, `${fieldBase}.sourceExpression`, "invalid_expression");
  }
  if (!AFFINITY_EXPRESSIONS.includes(input.targetExpression)) {
    addError(errors, `${fieldBase}.targetExpression`, "invalid_expression");
  }
  if (input.expectedOutcome !== undefined && !OUTCOME_TYPES.includes(input.expectedOutcome)) {
    addError(errors, `${fieldBase}.expectedOutcome`, "invalid_outcome");
  }
  return {
    id,
    kind,
    sourceKind: input.sourceKind,
    sourceExpression: input.sourceExpression,
    targetKind: input.targetKind,
    targetExpression: input.targetExpression,
    expectedOutcome: input.expectedOutcome,
  };
}

function normalizeInteractionContract(input = {}, fieldBase, errors) {
  if (input === undefined) {
    return cloneJson(DEFAULT_INTERACTION_CONTRACT);
  }
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_interaction_contract");
    return cloneJson(DEFAULT_INTERACTION_CONTRACT);
  }
  const expressionSemantics = normalizeExpressionSemanticsMap(
    input.expressionSemantics,
    `${fieldBase}.expressionSemantics`,
    errors,
  );
  const closeProximityNegation = normalizeCloseProximityNegation(
    input.closeProximityNegation,
    `${fieldBase}.closeProximityNegation`,
    errors,
  );
  const examplesInput = Array.isArray(input.interactionExamples)
    ? input.interactionExamples
    : DEFAULT_INTERACTION_CONTRACT.interactionExamples;
  const interactionExamples = examplesInput
    .map((entry, index) => normalizeInteractionExample(entry, `${fieldBase}.interactionExamples[${index}]`, errors))
    .filter(Boolean);
  return {
    expressionSemantics,
    closeProximityNegation,
    interactionExamples,
  };
}

function normalizeStationaryManaPolicy(input = {}, fieldBase, errors) {
  if (input === undefined) {
    return cloneJson(DEFAULT_WORLD_ACTOR_COST_MODEL.stationaryManaPolicy);
  }
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_stationary_mana_policy");
    return cloneJson(DEFAULT_WORLD_ACTOR_COST_MODEL.stationaryManaPolicy);
  }
  const poweredEffectRequiresPositiveReserve = input.poweredEffectRequiresPositiveReserve === undefined
    ? true
    : input.poweredEffectRequiresPositiveReserve === true;
  const allowZeroReserveAffinityState = input.allowZeroReserveAffinityState === undefined
    ? true
    : input.allowZeroReserveAffinityState === true;
  const regenOptional = input.regenOptional === undefined ? true : input.regenOptional === true;
  return {
    poweredEffectRequiresPositiveReserve,
    allowZeroReserveAffinityState,
    regenOptional,
  };
}

function normalizeWorldActorCostModel(input = {}, fieldBase, errors) {
  if (input === undefined) {
    return cloneJson(DEFAULT_WORLD_ACTOR_COST_MODEL);
  }
  if (!isPlainObject(input)) {
    addError(errors, fieldBase, "invalid_world_actor_cost_model");
    return cloneJson(DEFAULT_WORLD_ACTOR_COST_MODEL);
  }
  const roomWideAffinityMode = ROOM_AFFINITY_MODES.includes(input.roomWideAffinityMode)
    ? input.roomWideAffinityMode
    : "optional";
  if (input.roomWideAffinityMode !== undefined && !ROOM_AFFINITY_MODES.includes(input.roomWideAffinityMode)) {
    addError(errors, `${fieldBase}.roomWideAffinityMode`, "invalid_room_affinity_mode");
  }
  const fixedPositionNeutralProfile = normalizeFixedPositionWorldActorCostProfile(
    input.fixedPositionNeutralProfile || DEFAULT_WORLD_ACTOR_COST_MODEL.fixedPositionNeutralProfile,
    errors,
    `${fieldBase}.fixedPositionNeutralProfile`,
  );
  const stationaryManaPolicy = normalizeStationaryManaPolicy(
    input.stationaryManaPolicy,
    `${fieldBase}.stationaryManaPolicy`,
    errors,
  );
  const trapArchetype = normalizeTrapArchetypeRules(
    input.trapArchetype || DEFAULT_WORLD_ACTOR_COST_MODEL.trapArchetype,
    errors,
    `${fieldBase}.trapArchetype`,
  );
  return {
    roomWideAffinityMode,
    fixedPositionNeutralProfile,
    stationaryManaPolicy,
    trapArchetype,
  };
}

export function normalizeAffinityRulesArtifact(input = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    addError(errors, "artifact", "invalid_artifact");
    return { ok: false, errors, warnings, value: null };
  }
  if (input.schema !== "agent-kernel/AffinityRulesArtifact") {
    addError(errors, "schema", "invalid_schema");
  }
  if (input.schemaVersion !== 1) {
    addError(errors, "schemaVersion", "invalid_schema_version");
  }
  if (!isPlainObject(input.meta) || !isNonEmptyString(input.meta.id)) {
    addError(errors, "meta", "invalid_meta");
  }
  if (!isNonEmptyString(input.balanceVersion)) {
    addError(errors, "balanceVersion", "invalid_balance_version");
  }
  if (!isNonEmptyString(input.contentHash)) {
    addError(errors, "contentHash", "invalid_content_hash");
  }
  if (!isNonEmptyString(input.rulesetName)) {
    addError(errors, "rulesetName", "invalid_ruleset_name");
  }
  if (!Array.isArray(input.affinities)) {
    addError(errors, "affinities", "invalid_list");
    return { ok: false, errors, warnings, value: null };
  }

  const affinities = input.affinities
    .map((affinity, index) => normalizeAffinity(affinity, `affinities[${index}]`, errors))
    .filter(Boolean);
  const seenKinds = new Set();
  affinities.forEach((affinity, index) => {
    if (seenKinds.has(affinity.kind)) {
      addError(errors, `affinities[${index}].kind`, "duplicate_kind");
    }
    seenKinds.add(affinity.kind);
  });
  AFFINITY_KINDS.forEach((kind) => {
    if (!seenKinds.has(kind)) {
      addError(errors, "affinities", `missing_affinity_${kind}`);
    }
  });

  const interactions = Array.isArray(input.interactions)
    ? input.interactions.map((entry, index) => normalizeInteraction(entry, `interactions[${index}]`, errors)).filter(Boolean)
    : [];

  const globals = isPlainObject(input.globals)
    ? {
      defaultOutcomeOnWin: OUTCOME_TYPES.includes(input.globals.defaultOutcomeOnWin)
        ? input.globals.defaultOutcomeOnWin
        : "suppress",
      defaultOutcomeOnTie: OUTCOME_TYPES.includes(input.globals.defaultOutcomeOnTie)
        ? input.globals.defaultOutcomeOnTie
        : "cancel",
      defaultMana: normalizeManaPolicy(input.globals.defaultMana, "globals.defaultMana", errors),
      drawConversion: normalizeDrawConversion(input.globals.drawConversion, "globals.drawConversion", errors),
    }
    : {
      defaultOutcomeOnWin: "suppress",
      defaultOutcomeOnTie: "cancel",
      defaultMana: undefined,
      drawConversion: undefined,
    };
  const interactionContract = normalizeInteractionContract(
    input.interactionContract,
    "interactionContract",
    errors,
  );
  const worldActorCostModel = normalizeWorldActorCostModel(
    input.worldActorCostModel,
    "worldActorCostModel",
    errors,
  );

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    value: ok ? {
      schema: input.schema,
      schemaVersion: input.schemaVersion,
      meta: input.meta,
      balanceVersion: input.balanceVersion,
      contentHash: input.contentHash,
      rulesetName: input.rulesetName,
      globals,
      interactionContract,
      worldActorCostModel,
      affinities,
      interactions,
    } : null,
  };
}

export const DEFAULT_AFFINITY_RULES_ARTIFACT = Object.freeze({
  schema: "agent-kernel/AffinityRulesArtifact",
  schemaVersion: 1,
  meta: Object.freeze({
    id: "affinity_rules_basic",
    runId: "run_affinity_rules_basic",
    createdAt: "2026-03-22T00:00:00.000Z",
    producedBy: "runtime-defaults",
  }),
  balanceVersion: "2026.03.22",
  contentHash: "sha256:affinity-rules-basic",
  rulesetName: "Basic Affinity Rules",
  globals: Object.freeze({
    defaultOutcomeOnWin: "suppress",
    defaultOutcomeOnTie: "cancel",
    defaultMana: Object.freeze({
      winnerSpend: "full",
      loserSpend: "half",
      tieSpend: "full",
      clashCost: 1,
      overpowerBonusCost: 1,
      drainOnFail: 0,
    }),
  }),
  interactionContract: Object.freeze({
    expressionSemantics: Object.freeze(cloneJson(DEFAULT_EXPRESSION_SEMANTICS)),
    closeProximityNegation: Object.freeze(cloneJson(DEFAULT_CLOSE_PROXIMITY_NEGATION)),
    interactionExamples: Object.freeze(cloneJson(DEFAULT_INTERACTION_CONTRACT.interactionExamples)),
  }),
  worldActorCostModel: Object.freeze({
    roomWideAffinityMode: "optional",
    fixedPositionNeutralProfile: Object.freeze(cloneJson(DEFAULT_WORLD_ACTOR_COST_MODEL.fixedPositionNeutralProfile)),
    stationaryManaPolicy: Object.freeze(cloneJson(DEFAULT_WORLD_ACTOR_COST_MODEL.stationaryManaPolicy)),
    trapArchetype: Object.freeze(cloneJson(DEFAULT_WORLD_ACTOR_COST_MODEL.trapArchetype)),
  }),
  affinities: Object.freeze([
    Object.freeze({
      kind: "fire",
      opposite: "water",
      basePriority: 1,
      expressions: Object.freeze([
        Object.freeze({
          id: "flame_surge",
          verb: "push",
          defaultTargetType: "enemy",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 3, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 6, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 9, potency: 4, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 12, potency: 8, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 15, potency: 16, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
        }),
        Object.freeze({
          id: "ember_grasp",
          verb: "pull",
          defaultTargetType: "self",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 1, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 2, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 3, potency: 3, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 4, potency: 4, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 5, potency: 5, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
        }),
        Object.freeze({
          id: "pyre_field",
          verb: "emit",
          defaultTargetType: "area",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 2, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 4, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 6, potency: 3, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 8, potency: 4, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 10, potency: 5, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
          manaScaling: Object.freeze({
            persistentAreaSurcharge: 2,
            environmentMutationSurcharge: 1,
          }),
        }),
        Object.freeze({
          id: "ember_siphon",
          verb: "draw",
          defaultTargetType: "self",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 1, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 2, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 3, potency: 3, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 4, potency: 4, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 5, potency: 5, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      kind: "water",
      opposite: "fire",
      basePriority: 1,
      expressions: Object.freeze([
        Object.freeze({
          id: "tidal_ram",
          verb: "push",
          defaultTargetType: "enemy",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 2, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 4, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 6, potency: 3, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 8, potency: 4, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 10, potency: 5, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
        }),
        Object.freeze({
          id: "current_draw",
          verb: "pull",
          defaultTargetType: "self",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 1, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 2, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 3, potency: 3, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 4, potency: 4, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 5, potency: 5, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
        }),
        Object.freeze({
          id: "tidal_veil",
          verb: "emit",
          defaultTargetType: "area",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 2, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 3, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 5, potency: 3, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 7, potency: 4, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 9, potency: 5, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
          manaScaling: Object.freeze({
            persistentAreaSurcharge: 1,
          }),
        }),
        Object.freeze({
          id: "tide_siphon",
          verb: "draw",
          defaultTargetType: "self",
          stackTiers: Object.freeze([
            Object.freeze({ tier: 1, manaCost: 1, potency: 1, defaultDesignCostTokens: 4, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[1] }),
            Object.freeze({ tier: 2, manaCost: 2, potency: 2, defaultDesignCostTokens: 16, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[2] }),
            Object.freeze({ tier: 3, manaCost: 3, potency: 3, defaultDesignCostTokens: 36, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[3] }),
            Object.freeze({ tier: 4, manaCost: 4, potency: 4, defaultDesignCostTokens: 64, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[4] }),
            Object.freeze({ tier: 5, manaCost: 5, potency: 5, defaultDesignCostTokens: 100, complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[5] }),
          ]),
        }),
      ]),
    }),
    ...["earth", "wind", "life", "decay", "corrode", "fortify", "light", "dark"].map((kind) => {
      const opposite = AFFINITY_OPPOSITES[kind];
      const pushId = {
        earth: "stone_ram",
        wind: "gust_lance",
        life: "bloom_strike",
        decay: "rot_strike",
        corrode: "rust_blow",
        fortify: "bulwark_drive",
        light: "prism_burst",
        dark: "shade_lash",
      }[kind];
      const pullId = {
        earth: "stone_draw",
        wind: "draft_pull",
        life: "vital_draw",
        decay: "wither_draw",
        corrode: "etch_draw",
        fortify: "anchor_draw",
        light: "lumen_draw",
        dark: "gloom_draw",
      }[kind];
      const emitId = {
        earth: "stone_field",
        wind: "storm_ring",
        life: "verdant_aura",
        decay: "blight_mist",
        corrode: "acid_haze",
        fortify: "bulwark_field",
        light: "radiant_field",
        dark: "umbral_field",
      }[kind];
      const drawId = {
        earth: "bedrock_siphon",
        wind: "breeze_siphon",
        life: "vitality_siphon",
        decay: "wither_siphon",
        corrode: "rust_siphon",
        fortify: "bulwark_siphon",
        light: "radiance_siphon",
        dark: "shadow_siphon",
      }[kind];
      const pushCosts = kind === "earth" ? [3, 5, 7, 9, 11] : [2, 4, 6, 8, 10];
      const pullCosts = kind === "life" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
      const emitCosts = [2, 4, 6, 8, 10];
      const drawCosts = kind === "life" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
      const potencyByTier = kind === "life" ? [1, 2, 3, 4, 5] : null;
      return Object.freeze({
        kind,
        opposite,
        basePriority: 1,
        expressions: Object.freeze([
          Object.freeze({
            id: pushId,
            verb: "push",
            defaultTargetType: "enemy",
            stackTiers: Object.freeze(pushCosts.map((manaCost, index) => Object.freeze({
              tier: index + 1,
              manaCost,
              defaultDesignCostTokens: 4 * Math.pow(index + 1, 2),
              complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[index + 1],
            }))),
          }),
          Object.freeze({
            id: pullId,
            verb: "pull",
            defaultTargetType: "self",
            stackTiers: Object.freeze(pullCosts.map((manaCost, index) => {
              const tier = index + 1;
              const base = {
                tier,
                manaCost,
                defaultDesignCostTokens: 4 * Math.pow(tier, 2),
                complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[tier],
              };
              if (Array.isArray(potencyByTier)) {
                base.potency = potencyByTier[index];
              }
              return Object.freeze(base);
            })),
          }),
          Object.freeze({
            id: emitId,
            verb: "emit",
            defaultTargetType: "area",
            stackTiers: Object.freeze(emitCosts.map((manaCost, index) => Object.freeze({
              tier: index + 1,
              manaCost,
              defaultDesignCostTokens: 4 * Math.pow(index + 1, 2),
              complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[index + 1],
            }))),
          }),
          Object.freeze({
            id: drawId,
            verb: "draw",
            defaultTargetType: "self",
            stackTiers: Object.freeze(drawCosts.map((manaCost, index) => {
              const tier = index + 1;
              const base = {
                tier,
                manaCost,
                defaultDesignCostTokens: 4 * Math.pow(tier, 2),
                complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[tier],
              };
              if (Array.isArray(potencyByTier)) {
                base.potency = potencyByTier[index];
              }
              return Object.freeze(base);
            })),
          }),
        ]),
      });
    }),
  ]),
  interactions: Object.freeze([
    Object.freeze({
      sourceKind: "fire",
      targetKind: "water",
      outcomeOnSourceWin: "mutate_environment",
      outcomeOnTargetWin: "suppress",
      outcomeOnTie: "cancel",
      mana: Object.freeze({
        winnerSpend: "full",
        loserSpend: "half",
        tieSpend: "full",
        clashCost: 1,
        overpowerBonusCost: 1,
      }),
    }),
    Object.freeze({
      sourceKind: "light",
      targetKind: "dark",
      outcomeOnSourceWin: "reflect",
      outcomeOnTargetWin: "suppress",
      outcomeOnTie: "cancel",
      mana: Object.freeze({
        winnerSpend: "full",
        loserSpend: "full",
        tieSpend: "half",
      }),
    }),
  ]),
});

const DEFAULT_AFFINITY_RULES_RESULT = normalizeAffinityRulesArtifact(DEFAULT_AFFINITY_RULES_ARTIFACT);

if (!DEFAULT_AFFINITY_RULES_RESULT.ok) {
  throw new Error(
    `Default affinity rules invalid: ${DEFAULT_AFFINITY_RULES_RESULT.errors.map((entry) => `${entry.field}:${entry.code}`).join(", ")}`,
  );
}

export const DEFAULT_AFFINITY_RULES = Object.freeze(cloneJson(DEFAULT_AFFINITY_RULES_RESULT.value));

export function resolveAffinityRules(rules) {
  if (!rules) return DEFAULT_AFFINITY_RULES;
  const normalized = normalizeAffinityRulesArtifact(rules);
  return normalized.ok ? normalized.value : DEFAULT_AFFINITY_RULES;
}

export function findAffinityRule(rules, kind) {
  const resolvedRules = resolveAffinityRules(rules);
  return Array.isArray(resolvedRules?.affinities)
    ? resolvedRules.affinities.find((entry) => entry?.kind === kind) || null
    : null;
}

export function findExpressionRule(rules, kind, expression) {
  const affinity = findAffinityRule(rules, kind);
  if (!affinity) return null;
  return affinity.expressions.find((entry) => entry.id === expression || entry.verb === expression) || null;
}

export function resolveAffinityCastProfile({
  rules,
  kind,
  expression,
  stacks = 1,
  context = {},
} = {}) {
  const resolvedRules = resolveAffinityRules(rules);
  const expressionRule = findExpressionRule(resolvedRules, kind, expression);
  if (!expressionRule) return null;
  const tier = Math.max(1, Math.min(5, Number.isInteger(stacks) ? stacks : 1));
  const tierRule = expressionRule.stackTiers.find((entry) => entry.tier === tier);
  if (!tierRule) return null;
  const scaling = expressionRule.manaScaling || {};
  const areaSize = Number.isFinite(context.areaSize) ? context.areaSize : 0;
  const targetCount = Number.isFinite(context.targetCount) ? context.targetCount : 0;
  const duration = Number.isFinite(context.duration) ? context.duration : 0;
  let manaCost = tierRule.manaCost;
  manaCost += areaSize * (scaling.areaSizeMultiplier || 0);
  manaCost += targetCount * (scaling.targetCountMultiplier || 0);
  manaCost += duration * (scaling.durationMultiplier || 0);
  if (context.persistentArea) manaCost += scaling.persistentAreaSurcharge || 0;
  if (context.environmentMutation) manaCost += scaling.environmentMutationSurcharge || 0;
  if (context.overrideAffinity) manaCost += scaling.overrideAffinitySurcharge || 0;
  const expressionSemantics = resolvedRules?.interactionContract?.expressionSemantics?.[expressionRule.verb] || null;
  const closeProximityNegation = expressionSemantics?.closeProximityNegation
    || resolvedRules?.interactionContract?.closeProximityNegation
    || null;
  return {
    tier,
    expressionId: expressionRule.id,
    verb: expressionRule.verb,
    targetType: expressionRule.defaultTargetType,
    potency: tierRule.potency,
    defaultDesignCostTokens: tierRule.defaultDesignCostTokens,
    complexityClass: tierRule.complexityClass || DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[tier],
    unlockedEffects: tierRule.unlockedEffects || [],
    manaCost: Math.max(0, Math.round(manaCost)),
    channel: expressionSemantics?.channel,
    polarity: expressionSemantics?.polarity,
    rangeBehavior: expressionSemantics?.rangeBehavior ? cloneJson(expressionSemantics.rangeBehavior) : undefined,
    oppositeAffinityOutcome: expressionSemantics?.oppositeAffinityOutcome,
    vitalPressure: expressionSemantics?.vitalPressure ? cloneJson(expressionSemantics.vitalPressure) : undefined,
    closeProximityNegation: closeProximityNegation ? cloneJson(closeProximityNegation) : undefined,
  };
}

function findInteractionRule(rules, sourceKind, targetKind) {
  if (!Array.isArray(rules?.interactions)) return null;
  return rules.interactions.find((entry) => entry.sourceKind === sourceKind && entry.targetKind === targetKind) || null;
}

function applySpendPolicy(cost, policy) {
  if (policy === "none") return 0;
  if (policy === "half") return Math.round(cost / 2);
  return cost;
}

export function resolveAffinityInteraction({ rules, source = {}, target = {} } = {}) {
  const resolvedRules = resolveAffinityRules(rules);
  const sourceProfile = resolveAffinityCastProfile({
    rules: resolvedRules,
    kind: source.kind,
    expression: source.expression,
    stacks: source.stacks,
    context: source.context,
  });
  const targetProfile = resolveAffinityCastProfile({
    rules: resolvedRules,
    kind: target.kind,
    expression: target.expression,
    stacks: target.stacks,
    context: target.context,
  });
  const sourceTier = sourceProfile?.tier || Math.max(1, Math.min(5, Number.isInteger(source.stacks) ? source.stacks : 1));
  const targetTier = targetProfile?.tier || Math.max(1, Math.min(5, Number.isInteger(target.stacks) ? target.stacks : 1));
  const sourceAffinity = findAffinityRule(resolvedRules, source.kind);
  const targetAffinity = findAffinityRule(resolvedRules, target.kind);
  const directRule = findInteractionRule(resolvedRules, source.kind, target.kind);
  const defaultMana = resolvedRules?.globals?.defaultMana || {};
  const sourceBaseCost = sourceProfile?.manaCost || 0;
  const targetBaseCost = targetProfile?.manaCost || 0;

  let winner = "tie";
  if (sourceTier > targetTier) {
    winner = "source";
  } else if (targetTier > sourceTier) {
    winner = "target";
  } else {
    const sourcePriority = sourceAffinity?.basePriority || 0;
    const targetPriority = targetAffinity?.basePriority || 0;
    if (sourcePriority > targetPriority) {
      winner = "source";
    } else if (targetPriority > sourcePriority) {
      winner = "target";
    }
  }

  const manaRule = {
    ...defaultMana,
    ...(directRule?.mana || {}),
  };
  const delta = Math.abs(sourceTier - targetTier);
  let outcome = resolvedRules?.globals?.defaultOutcomeOnTie || "cancel";
  let sourceManaSpent = sourceBaseCost;
  let targetManaSpent = targetBaseCost;

  if (winner === "source") {
    outcome = directRule?.outcomeOnSourceWin || resolvedRules?.globals?.defaultOutcomeOnWin || "suppress";
    sourceManaSpent = applySpendPolicy(sourceBaseCost, manaRule.winnerSpend || "full");
    targetManaSpent = applySpendPolicy(targetBaseCost, manaRule.loserSpend || "full");
    sourceManaSpent += delta > 0 ? manaRule.overpowerBonusCost || 0 : 0;
    targetManaSpent += manaRule.drainOnFail || 0;
    if (manaRule.refundPercent) {
      targetManaSpent = Math.max(0, Math.round(targetManaSpent * (1 - (manaRule.refundPercent / 100))));
    }
  } else if (winner === "target") {
    outcome = directRule?.outcomeOnTargetWin || resolvedRules?.globals?.defaultOutcomeOnWin || "suppress";
    sourceManaSpent = applySpendPolicy(sourceBaseCost, manaRule.loserSpend || "full");
    targetManaSpent = applySpendPolicy(targetBaseCost, manaRule.winnerSpend || "full");
    targetManaSpent += delta > 0 ? manaRule.overpowerBonusCost || 0 : 0;
    sourceManaSpent += manaRule.drainOnFail || 0;
    if (manaRule.refundPercent) {
      sourceManaSpent = Math.max(0, Math.round(sourceManaSpent * (1 - (manaRule.refundPercent / 100))));
    }
  } else {
    outcome = directRule?.outcomeOnTie || resolvedRules?.globals?.defaultOutcomeOnTie || "cancel";
    sourceManaSpent = applySpendPolicy(sourceBaseCost, manaRule.tieSpend || "full") + (manaRule.clashCost || 0);
    targetManaSpent = applySpendPolicy(targetBaseCost, manaRule.tieSpend || "full") + (manaRule.clashCost || 0);
  }

  return {
    source: {
      kind: source.kind,
      expression: source.expression,
      tier: sourceTier,
      manaCost: sourceBaseCost,
      manaSpent: sourceManaSpent,
      expressionAlias: sourceProfile?.expressionId,
    },
    target: {
      kind: target.kind,
      expression: target.expression,
      tier: targetTier,
      manaCost: targetBaseCost,
      manaSpent: targetManaSpent,
      expressionAlias: targetProfile?.expressionId,
    },
    winner,
    tierDelta: delta,
    outcome,
  };
}
