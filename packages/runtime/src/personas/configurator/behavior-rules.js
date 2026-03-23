import {
  buildMotivationCostItems,
  deriveMotivationProfile,
  deriveReasoningClass,
  normalizeMotivationProfile,
} from "./motivation-loadouts.js";
import { findExpressionRule, resolveAffinityCastProfile } from "./affinity-rules.js";
import { resolveMotivationRules } from "./motivation-rules.js";

function findAffinityTierRule(rules, kind, expression, stacks = 1) {
  const expressionRule = findExpressionRule(rules, kind, expression);
  if (!expressionRule) return null;
  const tier = Math.max(1, Math.min(5, Number.isInteger(stacks) ? stacks : 1));
  return expressionRule.stackTiers.find((entry) => entry.tier === tier) || null;
}

export function resolveMotivationBehaviorProfile({
  rules,
  motivations = [],
  motivationProfile,
} = {}) {
  const resolvedRules = resolveMotivationRules(rules);
  const profile = deriveMotivationProfile(
    Array.isArray(motivations) ? motivations : [],
    normalizeMotivationProfile(motivationProfile, { rules: resolvedRules }),
    { rules: resolvedRules },
  );
  const reasoningClass = deriveReasoningClass(profile, { rules: resolvedRules });
  return {
    rules: resolvedRules,
    motivationProfile: profile,
    reasoningClass,
    complexityClass: reasoningClass,
    costItems: buildMotivationCostItems(profile, { rules: resolvedRules }),
  };
}

export function resolveAffinityBehaviorProfile({
  rules,
  kind,
  expression,
  stacks = 1,
  context,
} = {}) {
  const castProfile = resolveAffinityCastProfile({
    rules,
    kind,
    expression,
    stacks,
    context,
  });
  const tierRule = findAffinityTierRule(rules, kind, expression, stacks);
  return {
    castProfile,
    expressionId: castProfile?.expressionId,
    tier: castProfile?.tier || (tierRule?.tier ?? Math.max(1, Math.min(5, Number.isInteger(stacks) ? stacks : 1))),
    defaultDesignCostTokens: Number.isInteger(castProfile?.defaultDesignCostTokens)
      ? castProfile.defaultDesignCostTokens
      : Number.isInteger(tierRule?.defaultDesignCostTokens)
        ? tierRule.defaultDesignCostTokens
        : null,
    complexityClass: castProfile?.complexityClass || tierRule?.complexityClass || null,
  };
}
