import { validateSpendProposal } from "../allocator/validate-spend.js";

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

const VITAL_KEYS = ["health", "mana", "stamina", "durability"];
const AFFINITY_EXPRESSION_IDS = Object.freeze({
  push: "affinity_expression_externalize",
  pull: "affinity_expression_internalize",
  emit: "affinity_expression_localized",
});
const MOTIVATION_IDS = Object.freeze({
  reflexive: "motivation_reflexive",
  goal_oriented: "motivation_goal_oriented",
  strategy_focused: "motivation_strategy_focused",
});

function normalizeMotivationTier(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]/g, "_");
  if (normalized === "random") return "reflexive";
  if (normalized === "logical") return "goal_oriented";
  if (normalized === "strategic") return "strategy_focused";
  if (normalized === "goal_oriented") return "goal_oriented";
  if (normalized === "strategy_focused") return "strategy_focused";
  if (normalized === "reflexive") return "reflexive";
  return null;
}

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
  return Array.isArray(rawList) ? rawList : [];
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
        const tier = typeof entry === "string"
          ? normalizeMotivationTier(entry)
          : normalizeMotivationTier(entry?.tier || entry?.kind || entry?.level);
        if (!tier) return;
        const motivationId = MOTIVATION_IDS[tier];
        accumulateItem(counts, motivationId, "motivation", 1);
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
