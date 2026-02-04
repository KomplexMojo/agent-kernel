const BUDGET_ALLOCATION_SCHEMA = "agent-kernel/BudgetAllocationArtifact";
const BUDGET_ARTIFACT_SCHEMA = "agent-kernel/BudgetArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";

const DEFAULT_POOLS = Object.freeze([
  { id: "player", weight: 0.2, notes: "Player actor configuration" },
  { id: "layout", weight: 0.4, notes: "Level layout + tiles" },
  { id: "defenders", weight: 0.4, notes: "Defending actors + configuration" },
  { id: "loot", weight: 0.0, notes: "Optional drops/loot reserve" },
]);

function buildRef(artifact, fallbackSchema) {
  const meta = artifact?.meta;
  if (meta?.id && artifact?.schema && artifact?.schemaVersion) {
    return { id: meta.id, schema: artifact.schema, schemaVersion: artifact.schemaVersion };
  }
  return { id: meta?.id || "unknown", schema: fallbackSchema, schemaVersion: 1 };
}

function normalizeReserveTokens(policy = {}, totalTokens) {
  if (!Number.isInteger(totalTokens)) return 0;
  const reserve = Number.isInteger(policy.reserveTokens) ? policy.reserveTokens : 0;
  if (reserve < 0) return 0;
  return Math.min(reserve, totalTokens);
}

function allocatePools({ tokens, pools }) {
  if (!Number.isInteger(tokens) || tokens <= 0) {
    return pools.map((pool) => ({ id: pool.id, tokens: 0, notes: pool.notes }));
  }
  const totalWeight = pools.reduce((sum, pool) => sum + pool.weight, 0);
  const normalized = pools.map((pool) => ({
    id: pool.id,
    notes: pool.notes,
    raw: totalWeight > 0 ? (tokens * pool.weight) / totalWeight : 0,
  }));

  const withFloor = normalized.map((pool) => ({
    id: pool.id,
    notes: pool.notes,
    tokens: Math.floor(pool.raw),
    remainder: pool.raw - Math.floor(pool.raw),
  }));

  let allocated = withFloor.reduce((sum, pool) => sum + pool.tokens, 0);
  let remaining = tokens - allocated;

  if (remaining > 0) {
    const byRemainder = withFloor
      .slice()
      .sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
    for (let i = 0; i < byRemainder.length && remaining > 0; i += 1) {
      byRemainder[i].tokens += 1;
      remaining -= 1;
    }
    const byId = new Map(byRemainder.map((pool) => [pool.id, pool.tokens]));
    return pools.map((pool) => ({
      id: pool.id,
      tokens: byId.get(pool.id) || 0,
      notes: pool.notes,
    }));
  }

  return withFloor.map((pool) => ({ id: pool.id, tokens: pool.tokens, notes: pool.notes }));
}

function normalizePoolWeights(poolWeights) {
  const errors = [];
  const overrides = new Map();
  if (Array.isArray(poolWeights)) {
    poolWeights.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        errors.push({ field: `poolWeights[${index}]`, code: "invalid_pool_weight" });
        return;
      }
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id) {
        errors.push({ field: `poolWeights[${index}].id`, code: "invalid_pool_id" });
        return;
      }
      const weight = Number(entry.weight);
      if (!Number.isFinite(weight) || weight < 0) {
        errors.push({ field: `poolWeights[${index}].weight`, code: "invalid_pool_weight" });
        return;
      }
      if (!overrides.has(id)) {
        overrides.set(id, { id, weight });
      }
    });
  }

  const normalized = [];
  const used = new Set();
  DEFAULT_POOLS.forEach((pool) => {
    const override = overrides.get(pool.id);
    const weight = override ? override.weight : pool.weight;
    normalized.push({ id: pool.id, weight, notes: pool.notes });
    used.add(pool.id);
  });

  const extra = Array.from(overrides.values())
    .filter((entry) => !used.has(entry.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, weight: entry.weight }));
  normalized.push(...extra);

  const totalWeight = normalized.reduce((sum, pool) => sum + pool.weight, 0);
  if (totalWeight <= 0) {
    errors.push({ field: "poolWeights", code: "invalid_pool_weight_total" });
  }

  return { pools: normalized, errors };
}

export function computeBudgetPools({ budgetTokens, policy = {}, poolWeights } = {}) {
  const tokens = Number.isInteger(budgetTokens) ? budgetTokens : 0;
  const reserveTokens = normalizeReserveTokens(policy, tokens);
  const availableTokens = Math.max(0, tokens - reserveTokens);
  const normalized = normalizePoolWeights(poolWeights);
  if (normalized.errors.length > 0) {
    return { ok: false, errors: normalized.errors };
  }
  const pools = allocatePools({ tokens: availableTokens, pools: normalized.pools });
  return {
    ok: true,
    pools,
    poolWeights: normalized.pools,
    totalTokens: tokens,
    reserveTokens,
    availableTokens,
  };
}

export function buildBudgetAllocation({
  budget,
  priceList,
  budgetRef,
  priceListRef,
  meta,
  policy = {},
  poolWeights,
  budgetTokens,
} = {}) {
  const tokens = Number.isInteger(budgetTokens) ? budgetTokens : budget?.budget?.tokens;
  const result = computeBudgetPools({ budgetTokens: tokens, policy, poolWeights });
  if (!result.ok) {
    return { ok: false, errors: result.errors, allocation: null };
  }

  const allocation = {
    schema: BUDGET_ALLOCATION_SCHEMA,
    schemaVersion: 1,
    meta,
    budgetRef: budgetRef || buildRef(budget, BUDGET_ARTIFACT_SCHEMA),
    priceListRef: priceListRef || buildRef(priceList, PRICE_LIST_SCHEMA),
    pools: result.pools,
  };

  if (Number.isInteger(policy.reserveTokens) || Number.isInteger(policy.maxActorSpend)) {
    allocation.policy = {};
    if (Number.isInteger(policy.reserveTokens)) allocation.policy.reserveTokens = policy.reserveTokens;
    if (Number.isInteger(policy.maxActorSpend)) allocation.policy.maxActorSpend = policy.maxActorSpend;
  }

  return {
    ok: true,
    allocation,
    poolWeights: result.poolWeights,
    totalTokens: result.totalTokens,
    reserveTokens: result.reserveTokens,
    availableTokens: result.availableTokens,
  };
}

export const DEFAULT_BUDGET_POOLS = DEFAULT_POOLS;
