import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_OPPOSITES,
  AFFINITY_TARGET_TYPES,
  DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";
// M8: the artifact this module validates and the default it ships now name their schema
// from one place. The validator's expected value and the default's declared value were
// two independently retyped strings 80 lines apart, either of which could have drifted.
import { AFFINITY_RULES_ARTIFACT_SCHEMA } from "../../contracts/artifacts.ts";
import { BEHAVIOR_COMPLEXITY_CLASSES } from "./motivation-rules.js";
import { actorCastManaPrice } from "../../../../core-ts/src/rules/actor-cast.ts";

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
    // AM.4 — `defaultDesignCostTokens` is NOT normalized here any more.
    //
    // A design cost in tokens is the Allocator's, exclusively: the charter gives
    // it price lists, base costs and all pricing formulas, and forbids a base
    // cost literal in any other module (§261-263) and any alternate cost table
    // (§271-273). This artifact published 4/16/36/64/100 per tier while the
    // Allocator charged affinity from `base-costs.json` — different numbers for
    // the same concept. No code ever charged from these, which is the charter's
    // own named danger (§277-281): a published price with no charging path,
    // where "the price list reads complete, so nobody looks".
    //
    // Removing it is backward-compatible: the normalizer builds an explicit
    // object and rejects no unknown keys, so an older artifact still loads and
    // the field is simply dropped. No schemaVersion bump — nothing read it.
    if (tierEntry.complexityClass !== undefined && !BEHAVIOR_COMPLEXITY_CLASSES.includes(tierEntry.complexityClass)) {
      addError(errors, `${tierBase}.complexityClass`, "invalid_complexity_class");
    }
    if (tierEntry.unlockedEffects !== undefined && !Array.isArray(tierEntry.unlockedEffects)) {
      addError(errors, `${tierBase}.unlockedEffects`, "invalid_list");
    }
    return {
      tier: tierEntry.tier,
      // manaCost is the SIMULATION resource a cast consumes, not a design price:
      // a different currency, owned here as authored tuning data. core-ts cannot
      // supply it — its own formula charges 0 mana for push and pull at every
      // stack count (AM.4 finding F10c) — so this table is what the Moderator
      // and Actor read at tick time.
      manaCost: tierEntry.manaCost,
      potency: tierEntry.potency,
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

export function normalizeAffinityRulesArtifact(input = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    addError(errors, "artifact", "invalid_artifact");
    return { ok: false, errors, warnings, value: null };
  }
  if (input.schema !== AFFINITY_RULES_ARTIFACT_SCHEMA) {
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
      affinities,
      interactions,
    } : null,
  };
}

/**
 * The default rules, one row per kind. Every kind is built by the same function from
 * the same shape of row (maintainer, 2026-10-13: every affinity is a peer); fire and
 * water used to be written out by hand while the other eight came from a loop. The
 * numbers are tuning data and are unchanged: per-expression tier mana costs, the tier
 * potencies where a kind authors them, the expression ids, and any mana scaling.
 */
const LINEAR_TIERS = Object.freeze([1, 2, 3, 4, 5]);
// #477: one price for every kind. The rows differ only in their ids; each expression's tiers are
// the same shape for every affinity, so no kind is cheaper to play than another.
const UNIFORM_MANA_COST = Object.freeze({
  // #532 (#496 audit): pull costs what push does; it was half, for the same hit plus a steal.
  push: [2, 4, 6, 8, 10], pull: [2, 4, 6, 8, 10], emit: [2, 4, 6, 8, 10], draw: LINEAR_TIERS,
});
const DEFAULT_AFFINITY_ROWS = Object.freeze({
  fire: { ids: ["flame_surge", "ember_grasp", "pyre_field", "ember_siphon"], manaCost: UNIFORM_MANA_COST },
  water: { ids: ["tidal_ram", "current_draw", "tidal_veil", "tide_siphon"], manaCost: UNIFORM_MANA_COST },
  earth: { ids: ["stone_ram", "stone_draw", "stone_field", "bedrock_siphon"], manaCost: UNIFORM_MANA_COST },
  wind: { ids: ["gust_lance", "draft_pull", "storm_ring", "breeze_siphon"], manaCost: UNIFORM_MANA_COST },
  growth: { ids: ["bloom_strike", "vital_draw", "verdant_aura", "vitality_siphon"], manaCost: UNIFORM_MANA_COST },
  decay: { ids: ["rot_strike", "wither_draw", "blight_mist", "wither_siphon"], manaCost: UNIFORM_MANA_COST },
  corrode: { ids: ["rust_blow", "etch_draw", "acid_haze", "rust_siphon"], manaCost: UNIFORM_MANA_COST },
  fortify: { ids: ["bulwark_drive", "anchor_draw", "bulwark_field", "bulwark_siphon"], manaCost: UNIFORM_MANA_COST },
  light: { ids: ["prism_burst", "lumen_draw", "radiant_field", "radiance_siphon"], manaCost: UNIFORM_MANA_COST },
  dark: { ids: ["shade_lash", "gloom_draw", "umbral_field", "shadow_siphon"], manaCost: UNIFORM_MANA_COST },
});
const DEFAULT_TARGET_TYPE_BY_VERB = Object.freeze({ push: "enemy", pull: "self", emit: "area", draw: "self" });

function defaultAffinityRule(kind) {
  const row = DEFAULT_AFFINITY_ROWS[kind];
  return Object.freeze({
    kind,
    opposite: AFFINITY_OPPOSITES[kind],
    basePriority: 1,
    expressions: Object.freeze(["push", "pull", "emit", "draw"].map((verb, index) => {
      const potency = row.potency?.[verb];
      const expression = {
        id: row.ids[index],
        verb,
        defaultTargetType: DEFAULT_TARGET_TYPE_BY_VERB[verb],
        stackTiers: Object.freeze(row.manaCost[verb].map((manaCost, tierIndex) => Object.freeze({
          tier: tierIndex + 1,
          manaCost,
          ...(potency ? { potency: potency[tierIndex] } : {}),
          complexityClass: DEFAULT_AFFINITY_COMPLEXITY_BY_TIER[tierIndex + 1],
        }))),
      };
      if (row.manaScaling?.[verb]) expression.manaScaling = Object.freeze({ ...row.manaScaling[verb] });
      return Object.freeze(expression);
    })),
  });
}

export const DEFAULT_AFFINITY_RULES_ARTIFACT = Object.freeze({
  schema: AFFINITY_RULES_ARTIFACT_SCHEMA,
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
  affinities: Object.freeze(AFFINITY_KINDS.map((kind) => defaultAffinityRule(kind))),
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


/**
 * AM.5 — the authored mana cost of one cast. A READER, not an evaluator.
 *
 * The distinction matters, because a 143-line evaluator was just deleted from
 * this file (see below) and this must not become its seed. This resolves one
 * authored number from the rules artifact and returns it. It compares nothing,
 * decides no outcome, and spends nothing: applying an interaction is Moderator
 * work through core's matrix, and pricing in tokens is the Allocator's.
 *
 * Core owns the curve (`actorCastManaPrice`, base × intensity × r(r+1)/2, #340) but not the base:
 * mana is campaign-tunable data, and this artifact is where it is authored.
 *
 * A push or pull costs the kind's tier-1 price times its intensity times r(r+1)/2
 * of its range (`stacks`), with no cap (maintainer, 2026-10-13, #232; #340) — the
 * same curve core charges from
 * `castManaBase`. Emit and draw read their tier (1..5, clamped); their per-turn
 * upkeep is `computeInternalManaUpkeep`. A kind or expression the rules do not
 * describe returns null so the caller can refuse rather than invent a price.
 */
export function resolveAffinityManaCost({ rules, kind, expression, stacks = 1, intensity = 1 } = {}) {
  const expressionRule = findExpressionRule(resolveAffinityRules(rules), kind, expression);
  if (!expressionRule || !Array.isArray(expressionRule.stackTiers)) return null;
  const count = Math.max(1, Number.isInteger(stacks) ? stacks : 1);
  const cast = expression === 'push' || expression === 'pull';
  const tier = cast ? 1 : Math.min(5, count);
  const tierRule = expressionRule.stackTiers.find((entry) => entry.tier === tier);
  if (!Number.isInteger(tierRule?.manaCost)) return null;
  const strength = Number.isInteger(intensity) && intensity >= 1 ? intensity : 1;
  return cast ? actorCastManaPrice(tierRule.manaCost, count, strength) : tierRule.manaCost;
}

// ── AM.4 — the parallel cast/interaction EVALUATOR was deleted here ─────────
//
// `resolveAffinityCastProfile`, `resolveAffinityInteraction`, and their helpers
// `findInteractionRule` / `applySpendPolicy` (143 lines) computed cast profiles,
// tier comparisons, winners and mana spend from this artifact — a second
// evaluator for a concept core-ts already evaluates through the affinity field,
// the radius/intensity formulas and the 48-cell interaction matrix.
//
// They had NO consumers outside this file: nothing but each other ever called
// them. So this was never two live authorities competing — it was one live
// mechanic (core-ts, wired to the world) plus one dead duplicate that read like
// an authority to anyone who found it first.
//
// What stays here is what the Configurator actually owns: the artifact's SHAPE
// and VALIDITY — vocabulary, prerequisites, tier bounds, mana-cost monotonicity
// — plus `manaCost` as authored tuning data. Applying an interaction at tick
// time is Moderator authority (charter §29/§81) and runs through core's matrix;
// pricing in tokens is Allocator authority and runs through its price list.

/** Assemble authored vital costs for core; token pricing remains Allocator-owned. */
export function resolveActorTurnCosts({ rules, movementStamina } = {}) {
  if (!movementStamina || typeof movementStamina !== 'object' || Array.isArray(movementStamina)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(movementStamina))) {
    throw new Error(`invalid movement stamina costs: expected ID-keyed plain object, received ${Object.prototype.toString.call(movementStamina)}`);
  }
  const invalidMovement = Object.entries(movementStamina).find(([id, cost]) => !id.trim()
    || !Number.isSafeInteger(cost) || cost < 0);
  if (invalidMovement) {
    throw new Error(`invalid movement stamina cost for actor ${JSON.stringify(invalidMovement[0])}: ${String(invalidMovement[1])}; expected a nonnegative safe integer`);
  }
  const normalized = rules === undefined
    ? { ok: true, value: DEFAULT_AFFINITY_RULES }
    : normalizeAffinityRulesArtifact(rules);
  if (!normalized.ok) throw new Error(`invalid authored affinity rules: ${JSON.stringify(normalized.errors)}`);
  // Core prices each cast as base × s(s+1)/2 (#232); the base is the authored tier-1 price.
  const entries = [];
  for (const kind of AFFINITY_KINDS) {
    for (const expression of AFFINITY_EXPRESSIONS) {
      const rule = normalized.value.affinities.find(entry => entry.kind === kind)
        ?.expressions.find(entry => entry.verb === expression);
      const base = rule?.stackTiers.find(entry => entry.tier === 1)?.manaCost;
      if (!Number.isSafeInteger(base) || base < 0) {
        throw new Error(`missing authored mana costs: ${kind}:${expression}`);
      }
      entries.push([`${kind}:${expression}`, base]);
    }
  }
  return { castManaBase: Object.fromEntries(entries), movementStamina: structuredClone(movementStamina) };
}
