const BUDGET_ALLOCATION_SCHEMA = "agent-kernel/BudgetAllocationArtifact";
const BUDGET_ARTIFACT_SCHEMA = "agent-kernel/BudgetArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";

const DEFAULT_POOLS = Object.freeze([
  { id: "layout", weight: 0.4, notes: "Level layout + tiles" },
  { id: "actors", weight: 0.4, notes: "Actor builds" },
  { id: "affinity_motivation", weight: 0.2, notes: "Affinity + motivation reserve" },
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

export function buildBudgetAllocation({
  budget,
  priceList,
  budgetRef,
  priceListRef,
  meta,
  policy = {},
} = {}) {
  const tokens = budget?.budget?.tokens;
  const reserveTokens = normalizeReserveTokens(policy, tokens);
  const availableTokens = Number.isInteger(tokens) ? Math.max(0, tokens - reserveTokens) : 0;
  const pools = allocatePools({ tokens: availableTokens, pools: DEFAULT_POOLS });

  const allocation = {
    schema: BUDGET_ALLOCATION_SCHEMA,
    schemaVersion: 1,
    meta,
    budgetRef: budgetRef || buildRef(budget, BUDGET_ARTIFACT_SCHEMA),
    priceListRef: priceListRef || buildRef(priceList, PRICE_LIST_SCHEMA),
    pools,
  };

  if (Number.isInteger(policy.reserveTokens) || Number.isInteger(policy.maxActorSpend)) {
    allocation.policy = {};
    if (Number.isInteger(policy.reserveTokens)) allocation.policy.reserveTokens = policy.reserveTokens;
    if (Number.isInteger(policy.maxActorSpend)) allocation.policy.maxActorSpend = policy.maxActorSpend;
  }

  return allocation;
}
