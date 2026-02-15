import { validateSpendProposal } from "../allocator/validate-spend.js";
import { evaluateLayoutSpend } from "../allocator/layout-spend.js";
import { normalizeMotivations, MOTIVATION_KIND_IDS } from "./motivation-loadouts.js";
import { VITAL_KEYS } from "../../contracts/domain-constants.js";
import { COST_DEFAULTS } from "./cost-model.js";

const SPEND_PROPOSAL_SCHEMA = "agent-kernel/SpendProposal";

function isInteger(value) {
  return Number.isInteger(value);
}

function readLayoutData(layout) {
  if (!layout) return {};
  return layout.data && typeof layout.data === "object" ? layout.data : layout;
}

function countTraps(layoutData, trapsOverride) {
  if (Array.isArray(trapsOverride)) return trapsOverride.length;
  if (Array.isArray(layoutData?.traps)) return layoutData.traps.length;
  return 0;
}

const AFFINITY_EXPRESSION_IDS = Object.freeze({
  push: "affinity_expression_externalize",
  pull: "affinity_expression_internalize",
  emit: "affinity_expression_localized",
});
const VITAL_POINT_IDS = Object.freeze({
  health: "vital_health_point",
  mana: "vital_mana_point",
  stamina: "vital_stamina_point",
  durability: "vital_durability_point",
});
const VITAL_REGEN_IDS = Object.freeze({
  health: "vital_health_regen_tick",
  mana: "vital_mana_regen_tick",
  stamina: "vital_stamina_regen_tick",
  durability: "vital_durability_regen_tick",
});

function accumulateItem(counts, id, kind, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) return;
  const key = `${kind}:${id}`;
  const existing = counts.get(key);
  if (existing) {
    existing.quantity += quantity;
    return;
  }
  counts.set(key, { id, kind, quantity });
}

function extractAffinities(actor) {
  const entries = [];
  const affinityMap = actor?.traits?.affinities;
  if (affinityMap && typeof affinityMap === "object") {
    Object.entries(affinityMap).forEach(([key, stacks]) => {
      if (!Number.isInteger(stacks) || stacks <= 0) return;
      const [kind, expression] = key.split(":");
      if (!expression) return;
      entries.push({ expression, stacks });
    });
  }
  const affinityList = Array.isArray(actor?.affinities) ? actor.affinities : [];
  affinityList.forEach((entry) => {
    if (!entry) return;
    const stacks = Number.isInteger(entry.stacks) ? entry.stacks : 1;
    if (stacks <= 0) return;
    const expression = entry.expression || entry.kind || entry.type;
    if (!expression) return;
    entries.push({ expression, stacks });
  });
  return entries;
}

function extractMotivations(actor) {
  const rawList = actor?.motivations || actor?.traits?.motivations;
  const { value } = normalizeMotivations(rawList);
  return value || [];
}

function buildSpendItems({ layoutData, actors, trapCount }) {
  const counts = new Map();

  if (isInteger(layoutData?.width) && isInteger(layoutData?.height)) {
    accumulateItem(counts, `layout_grid_${layoutData.width}x${layoutData.height}`, "layout", 1);
  }

  if (Array.isArray(actors) && actors.length > 0) {
    accumulateItem(counts, "actor_spawn", "actor", actors.length);
  }

  if (trapCount > 0) {
    accumulateItem(counts, "trap_basic", "trap", trapCount);
  }

  if (Array.isArray(actors)) {
    actors.forEach((actor) => {
      const vitals = actor?.vitals;
      if (vitals && typeof vitals === "object") {
        VITAL_KEYS.forEach((key) => {
          const vital = vitals[key];
          if (!vital || typeof vital !== "object") return;
          const max = Number.isInteger(vital.max)
            ? vital.max
            : Number.isInteger(vital.current)
              ? vital.current
              : 0;
          accumulateItem(counts, `vital_${key}_point`, "vital", max);
          const regen = Number.isInteger(vital.regen) ? vital.regen : 0;
          accumulateItem(counts, `vital_${key}_regen_tick`, "vital", regen);
        });
      }

      const affinities = extractAffinities(actor);
      if (affinities.length > 0) {
        const totalStacks = affinities.reduce((sum, entry) => sum + entry.stacks, 0);
        accumulateItem(counts, "affinity_stack", "affinity", totalStacks);
        affinities.forEach((entry) => {
          const expressionId = AFFINITY_EXPRESSION_IDS[entry.expression];
          if (!expressionId) return;
          accumulateItem(counts, expressionId, "affinity", entry.stacks);
        });
      }

      const motivations = extractMotivations(actor);
      motivations.forEach((entry) => {
        const motivationId = MOTIVATION_KIND_IDS[entry.kind];
        if (!motivationId) return;
        const quantity = Number.isInteger(entry.intensity) && entry.intensity > 0 ? entry.intensity : 1;
        accumulateItem(counts, motivationId, "motivation", quantity);
      });
    });
  }

  return Array.from(counts.values()).sort((a, b) => {
    const kindOrder = a.kind.localeCompare(b.kind);
    if (kindOrder !== 0) return kindOrder;
    return a.id.localeCompare(b.id);
  });
}

export function buildSpendProposal({ meta, layout, actors, traps } = {}) {
  const layoutData = readLayoutData(layout);
  const trapCount = countTraps(layoutData, traps);
  const items = buildSpendItems({ layoutData, actors, trapCount });

  return {
    schema: SPEND_PROPOSAL_SCHEMA,
    schemaVersion: 1,
    meta,
    items,
  };
}

export function evaluateConfiguratorSpend({
  budget,
  priceList,
  layout,
  actors,
  traps,
  proposalMeta,
  receiptMeta,
} = {}) {
  const proposal = buildSpendProposal({ meta: proposalMeta, layout, actors, traps });
  const proposalRef = proposal?.meta?.id
    ? { id: proposal.meta.id, schema: proposal.schema, schemaVersion: proposal.schemaVersion }
    : undefined;
  const result = validateSpendProposal({
    budget,
    priceList,
    proposal,
    meta: receiptMeta,
    proposalRef,
  });
  return {
    proposal,
    receipt: result.receipt,
    errors: result.errors,
    allowed: result.receipt?.status === "approved",
  };
}

function normalizePositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  return floored >= 0 ? floored : fallback;
}

function normalizeActorVitalsForCost(entry) {
  const vitalsSource = entry?.vitals && typeof entry.vitals === "object" ? entry.vitals : {};
  const vitals = {};
  const regen = {};
  VITAL_KEYS.forEach((key) => {
    const record = vitalsSource[key];
    const rawMax = typeof record === "object" ? record?.max : record;
    const rawRegen = typeof record === "object" ? record?.regen : undefined;
    const max = normalizePositiveInt(rawMax, 0);
    const regenValue = normalizePositiveInt(rawRegen, 0);
    vitals[key] = max;
    regen[key] = regenValue;
  });
  return { vitals, regen };
}

function normalizeBudget(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function buildPriceMap(priceList) {
  const items = Array.isArray(priceList?.items) ? priceList.items : [];
  const map = new Map();
  items.forEach((item) => {
    if (typeof item?.id !== "string" || typeof item?.kind !== "string") return;
    if (!Number.isFinite(item?.costTokens) || item.costTokens < 0) return;
    map.set(`${item.kind}:${item.id}`, item.costTokens);
  });
  return map;
}

function resolveUnitCost({ priceMap, kind, id, fallback }) {
  const fromPriceList = priceMap.get(`${kind}:${id}`);
  if (Number.isFinite(fromPriceList) && fromPriceList >= 0) return fromPriceList;
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

function normalizeAffinityEntriesForCost(entry) {
  if (!Array.isArray(entry?.affinities)) return [];
  return entry.affinities
    .map((affinity) => {
      if (!affinity || typeof affinity !== "object") return null;
      const expression = typeof affinity.expression === "string" ? affinity.expression : "";
      const stacks = normalizePositiveInt(affinity.stacks, 1);
      if (!expression || stacks <= 0) return null;
      return { expression, stacks };
    })
    .filter(Boolean);
}

export function calculateActorConfigurationUnitCost({
  entry,
  priceMap,
  pricing = {},
} = {}) {
  const { vitals, regen } = normalizeActorVitalsForCost(entry);
  const affinities = normalizeAffinityEntriesForCost(entry);

  let vitalPoints = 0;
  let vitalCost = 0;
  VITAL_KEYS.forEach((key) => {
    const quantity = normalizePositiveInt(vitals[key], 0);
    if (quantity <= 0) return;
    vitalPoints += quantity;
    const id = VITAL_POINT_IDS[key];
    const unit = resolveUnitCost({
      priceMap,
      kind: "vital",
      id,
      fallback: pricing.tokensPerVital ?? COST_DEFAULTS.tokensPerVital,
    });
    vitalCost += quantity * unit;
  });

  let regenPoints = 0;
  let regenCost = 0;
  VITAL_KEYS.forEach((key) => {
    const quantity = normalizePositiveInt(regen[key], 0);
    if (quantity <= 0) return;
    regenPoints += quantity;
    const id = VITAL_REGEN_IDS[key];
    const unit = resolveUnitCost({
      priceMap,
      kind: "vital",
      id,
      fallback: pricing.tokensPerRegen ?? COST_DEFAULTS.tokensPerRegen,
    });
    regenCost += quantity * unit;
  });

  let affinityStacks = 0;
  let affinityCost = 0;
  const affinityStackUnit = resolveUnitCost({
    priceMap,
    kind: "affinity",
    id: "affinity_stack",
    fallback: pricing.affinityBaseCost ?? COST_DEFAULTS.affinityBaseCost,
  });
  affinities.forEach((affinity) => {
    const stacks = affinity.stacks;
    affinityStacks += stacks;
    const stackWeight = stacks * stacks;
    affinityCost += affinityStackUnit * stackWeight;

    const expressionId = AFFINITY_EXPRESSION_IDS[affinity.expression];
    if (!expressionId) return;
    const expressionUnit = resolveUnitCost({
      priceMap,
      kind: "affinity",
      id: expressionId,
      fallback: pricing.affinityBaseCost ?? COST_DEFAULTS.affinityBaseCost,
    });
    affinityCost += expressionUnit * stackWeight;
  });

  const cost = vitalCost + regenCost + affinityCost;
  return {
    cost,
    detail: {
      vitalPoints,
      regenPoints,
      affinityStacks,
      pricingSource: priceMap.size > 0 ? "price-list" : "fallback",
    },
  };
}

function asActorEntries({ actorSet, summary } = {}) {
  if (Array.isArray(actorSet) && actorSet.length > 0) {
    return actorSet.map((entry) => ({
      source: entry?.source === "room" ? "room" : "actor",
      id: entry?.id || "",
      motivation: entry?.role || entry?.motivation || "stationary",
      affinity: entry?.affinity || summary?.dungeonAffinity || "fire",
      count: normalizePositiveInt(entry?.count, 1) || 1,
      tokenHint: normalizePositiveInt(entry?.tokenHint, 0),
      vitals: entry?.vitals,
      affinities: entry?.affinities,
    }));
  }

  const rooms = Array.isArray(summary?.rooms) ? summary.rooms : [];
  const actors = Array.isArray(summary?.actors) ? summary.actors : [];
  const normalizedRooms = rooms.map((entry, index) => ({
    source: "room",
    id: entry?.id || `room_${index + 1}`,
    motivation: entry?.motivation || "stationary",
    affinity: entry?.affinity || summary?.dungeonAffinity || "fire",
    count: normalizePositiveInt(entry?.count, 1) || 1,
    tokenHint: normalizePositiveInt(entry?.tokenHint, 0),
    vitals: null,
    affinities: entry?.affinities,
  }));
  const normalizedActors = actors.map((entry, index) => ({
    source: "actor",
    id: entry?.id || `actor_${index + 1}`,
    motivation: entry?.motivation || entry?.role || "stationary",
    affinity: entry?.affinity || summary?.dungeonAffinity || "fire",
    count: normalizePositiveInt(entry?.count, 1) || 1,
    tokenHint: normalizePositiveInt(entry?.tokenHint, 0),
    vitals: entry?.vitals,
    affinities: entry?.affinities,
  }));
  return [...normalizedRooms, ...normalizedActors];
}

function buildCategory(category, spentTokens, budgetTokens) {
  const spent = normalizePositiveInt(spentTokens, 0);
  const budget = normalizeBudget(budgetTokens);
  const remainingTokens = Number.isInteger(budget) ? Math.max(0, budget - spent) : null;
  const overBudgetBy = Number.isInteger(budget) ? Math.max(0, spent - budget) : 0;
  return {
    category,
    spentTokens: spent,
    budgetTokens: budget,
    remainingTokens,
    overBudgetBy,
    overBudget: overBudgetBy > 0,
  };
}

export function buildDesignSpendLedger({
  summary,
  actorSet,
  budgeting,
  tileCosts,
  priceList,
  pricing = {},
} = {}) {
  const warnings = [];
  const budgetTokens = normalizeBudget(summary?.budgetTokens);
  const layoutResult = evaluateLayoutSpend({
    layout: summary?.layout,
    budgetTokens: Number.isInteger(budgetTokens) ? budgetTokens : undefined,
    tileCosts,
  });
  if (Array.isArray(layoutResult?.warnings)) {
    warnings.push(...layoutResult.warnings);
  }
  const entries = asActorEntries({ actorSet, summary });
  const priceMap = buildPriceMap(priceList);
  const lineItems = [];

  let levelConfigSpent = normalizePositiveInt(layoutResult?.spentTokens, 0);
  let actorBaseSpent = 0;
  let actorConfigSpent = 0;

  entries.forEach((entry) => {
    const count = normalizePositiveInt(entry?.count, 1) || 1;
    const tokenHint = normalizePositiveInt(entry?.tokenHint, 0);
    const entryId = entry.id || `${entry.source}_${entry.motivation}_${entry.affinity}`;
    if (entry.source !== "actor") {
      const baseSpend = tokenHint * count;
      if (baseSpend > 0) {
        lineItems.push({
          category: "levelConfig",
          id: entryId,
          source: entry.source,
          label: `${entry.source}:${entry.motivation}/${entry.affinity}`,
          count,
          unitCostTokens: tokenHint,
          spendTokens: baseSpend,
        });
        levelConfigSpent += baseSpend;
      }
      return;
    }

    const actorConfig = calculateActorConfigurationUnitCost({
      entry,
      priceMap,
      pricing,
    });
    if (tokenHint > 0) {
      const actorBaseSpend = tokenHint * count;
      actorBaseSpent += actorBaseSpend;
      lineItems.push({
        category: "actorBase",
        id: entryId,
        source: entry.source,
        label: `actor-base:${entry.motivation}/${entry.affinity}`,
        count,
        unitCostTokens: tokenHint,
        spendTokens: actorBaseSpend,
      });
    }

    const configUnitSpend = normalizePositiveInt(actorConfig.cost, 0);
    if (configUnitSpend > 0) {
      const configSpend = configUnitSpend * count;
      actorConfigSpent += configSpend;
      lineItems.push({
        category: "actorConfiguration",
        id: entryId,
        source: entry.source,
        label: `actor-config:${entry.motivation}/${entry.affinity}`,
        count,
        unitCostTokens: configUnitSpend,
        spendTokens: configSpend,
        detail: actorConfig.detail,
      });
    }
  });

  const totalSpentTokens = levelConfigSpent + actorBaseSpent + actorConfigSpent;
  const remainingTokens = Number.isInteger(budgetTokens) ? Math.max(0, budgetTokens - totalSpentTokens) : null;
  const totalOverBudgetBy = Number.isInteger(budgetTokens) ? Math.max(0, totalSpentTokens - budgetTokens) : 0;

  const categories = {
    levelConfig: buildCategory(
      "levelConfig",
      levelConfigSpent,
      normalizeBudget(budgeting?.levelBudgetTokens),
    ),
    actorBase: buildCategory(
      "actorBase",
      actorBaseSpent,
      normalizeBudget(budgeting?.actorBudgetTokens),
    ),
    actorConfiguration: buildCategory(
      "actorConfiguration",
      actorConfigSpent,
      normalizeBudget(budgeting?.actorBudgetTokens),
    ),
  };

  return {
    budgetTokens,
    totalSpentTokens,
    remainingTokens,
    totalOverBudgetBy,
    overBudget: totalOverBudgetBy > 0 || Object.values(categories).some((category) => category.overBudget),
    categories,
    lineItems,
    warnings: warnings.length > 0 ? warnings : [],
  };
}
