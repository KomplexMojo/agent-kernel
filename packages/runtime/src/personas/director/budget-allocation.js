const BUDGET_ALLOCATION_SCHEMA = "agent-kernel/BudgetAllocationArtifact";
const BUDGET_ARTIFACT_SCHEMA = "agent-kernel/BudgetArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";

/** Reference balancing budget (design §2.1). */
export const REFERENCE_BUDGET_TOKENS = 2500;

/** Default share of the total budget allocated to dungeon content. */
export const DEFAULT_DUNGEON_PCT = 0.80;

/** Default share of the total budget allocated to delver actors. */
export const DEFAULT_DELVER_PCT = 0.20;

/**
 * Default dungeon sub-pool split (applied to the dungeon share of the total budget).
 * rooms=55%, hazards=15%, wardens=20%, resources=10%
 */
export const DEFAULT_DUNGEON_SUB_POOLS = Object.freeze([
  { id: "rooms", weight: 0.55, notes: "Rooms / layout / traps (55% of dungeon)" },
  { id: "hazards", weight: 0.15, notes: "Hazard elements (15% of dungeon)" },
  { id: "wardens", weight: 0.20, notes: "Warden actors (20% of dungeon)" },
  { id: "resources", weight: 0.10, notes: "Resource drops (10% of dungeon)" },
]);

/**
 * Target spend values for the reference 2500-token budget (design §2.2).
 * rooms: 2500*0.44=1100, delvers: 2500*0.20=500, wardens: 2500*0.16=400
 */
export const REFERENCE_TARGETS = Object.freeze({
  rooms: 1100,
  delvers: 500,
  wardens: 400,
  hazards: 300,
  resources: 200,
});

/** Target delver/warden spend ratio (design §3.2): 200/250 = 0.8. */
export const TARGET_DELVER_WARDEN_RATIO = 0.8;

/**
 * Flat default pool weights derived from the two-tier defaults.
 * rooms: 0.55*0.80=0.44, hazards: 0.15*0.80=0.12, wardens: 0.20*0.80=0.16,
 * resources: 0.10*0.80=0.08, delver: 0.20
 */
const DEFAULT_POOLS = Object.freeze([
  { id: "rooms", weight: 0.44, notes: "Rooms / layout / traps" },
  { id: "hazards", weight: 0.12, notes: "Hazard elements" },
  { id: "wardens", weight: 0.16, notes: "Warden actors" },
  { id: "resources", weight: 0.08, notes: "Resource drops" },
  { id: "delver", weight: 0.20, notes: "Delver actors" },
]);

/** Backward-compatible alias. */
export const DEFAULT_BUDGET_POOLS = DEFAULT_POOLS;

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

/**
 * Apply resource cap: resources.tokens must not exceed hazards.tokens + wardens.tokens.
 * Any excess is redistributed to rooms.
 */
function applyResourceCap(pools) {
  const byId = new Map(pools.map((p) => [p.id, p]));
  const resources = byId.get("resources");
  const hazards = byId.get("hazards");
  const wardens = byId.get("wardens");
  const rooms = byId.get("rooms");
  if (!resources || !hazards || !wardens || !rooms) return pools;

  const cap = hazards.tokens + wardens.tokens;
  if (resources.tokens > cap) {
    const excess = resources.tokens - cap;
    resources.tokens = cap;
    rooms.tokens += excess;
  }
  return pools;
}

function normalizePoolWeights(poolWeights) {
  const errors = [];
  const overrides = new Map();
  const callerProvidedExplicit = Array.isArray(poolWeights) && poolWeights.length > 0;
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
    // When caller provides explicit poolWeights, pools not listed default to weight 0
    const weight = override ? override.weight : (callerProvidedExplicit ? 0 : pool.weight);
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

  // Resources are not gated by hazard/warden presence (rooms carry no affinity of
  // their own — see this file's DEFAULT_DUNGEON_SUB_POOLS note). When the caller
  // explicitly selected pools and simply didn't request any hazards or wardens,
  // both land at weight 0; the resources-vs-(hazards+wardens) cap below must not
  // punish that by zeroing out an explicitly funded resources pool. This also
  // covers the resources-only case (hazards and wardens are 0 there too).
  const byId = new Map(normalized.map((pool) => [pool.id, pool]));
  const resourcesExplicitUncapped = callerProvidedExplicit
    && (byId.get("resources")?.weight || 0) > 0
    && (byId.get("hazards")?.weight || 0) === 0
    && (byId.get("wardens")?.weight || 0) === 0;

  return { pools: normalized, errors, resourcesExplicitUncapped };
}

export function computeBudgetPools({ budgetTokens, policy = {}, dungeonPct, delverPct, poolWeights } = {}) {
  const tokens = Number.isInteger(budgetTokens) ? budgetTokens : 0;
  const reserveTokens = normalizeReserveTokens(policy, tokens);
  const availableTokens = Math.max(0, tokens - reserveTokens);
  const normalized = normalizePoolWeights(poolWeights);
  if (normalized.errors.length > 0) {
    return { ok: false, errors: normalized.errors };
  }

  let pools = allocatePools({ tokens: availableTokens, pools: normalized.pools });

  // Apply resource cap: resources must not exceed hazards + wardens (excess → rooms).
  // Skipped when the caller explicitly selected pools and simply didn't request any
  // hazards/wardens — that's an unrequested category, not a deliberate zero allocation,
  // and must not gate an explicitly funded resources pool (resources have no hazard
  // dependency; rooms carry no affinity of their own).
  if (!normalized.resourcesExplicitUncapped) {
    pools = applyResourceCap(pools);
  }

  // Compute convenience totals for two-tier reporting
  const dungeonPoolIds = new Set(["rooms", "hazards", "wardens", "resources"]);
  const dungeonTokens = pools.filter((p) => dungeonPoolIds.has(p.id)).reduce((s, p) => s + p.tokens, 0);
  const delverPool = pools.find((p) => p.id === "delver");
  const delverTokens = delverPool ? delverPool.tokens : 0;

  return {
    ok: true,
    pools,
    poolWeights: normalized.pools,
    totalTokens: tokens,
    reserveTokens,
    availableTokens,
    dungeonTokens,
    delverTokens,
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
  dungeonPct,
  delverPct,
  budgetTokens,
} = {}) {
  const tokens = Number.isInteger(budgetTokens) ? budgetTokens : budget?.budget?.tokens;
  const result = computeBudgetPools({ budgetTokens: tokens, policy, poolWeights, dungeonPct, delverPct });
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
    dungeonTokens: result.dungeonTokens,
    delverTokens: result.delverTokens,
  };
}
