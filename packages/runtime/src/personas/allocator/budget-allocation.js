/**
 * Budget pool allocation — how a total token budget is split into pools.
 *
 * CR.1: this module lived in `personas/director/` and was the largest of the
 * economy's leaked origins — seven pool/split constants plus `computeBudgetPools`
 * and `buildBudgetAllocation`, i.e. budget allocation POLICY inside the Director's
 * folder, which the Allocator then had to import back out (`incentive-model.js`).
 * The charter gives the Allocator sole ownership of the economy, so the policy lives
 * here and the Director asks for a split instead of defining one.
 *
 * The numbers are unchanged by the move — this is a relocation, not a retune, and
 * the goldens are the proof.
 */
import BASE_COSTS from "./base-costs.json" with { type: "json" };

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
  { id: "rooms", weight: 0.55, notes: "Rooms / layout / hazards (55% of dungeon)" },
  { id: "hazards", weight: 0.15, notes: "Hazard elements (15% of dungeon)" },
  { id: "wardens", weight: 0.20, notes: "Warden actors (20% of dungeon)" },
  { id: "resources", weight: 0.10, notes: "Resource drops (10% of dungeon)" },
]);

/**
 * Target spend values for the reference budget (design §2.2), DERIVED from the split.
 *
 * These were hardcoded (rooms 1100, hazards 300, …) as "2500 × the split" with the
 * arithmetic written in a comment — a third place the same percentages lived, and one that
 * silently stopped matching the moment CR.9 M5 retuned them. The comment was the only
 * thing tying them together, and a comment cannot fail. Now the arithmetic is the code.
 */
export const REFERENCE_TARGETS = Object.freeze({
  rooms: Math.round(REFERENCE_BUDGET_TOKENS * (BASE_COSTS.levelBudgetSplitPercent.room / 100)),
  delvers: Math.round(REFERENCE_BUDGET_TOKENS * (BASE_COSTS.levelBudgetSplitPercent.delver / 100)),
  wardens: Math.round(REFERENCE_BUDGET_TOKENS * (BASE_COSTS.levelBudgetSplitPercent.warden / 100)),
  hazards: Math.round(REFERENCE_BUDGET_TOKENS * (BASE_COSTS.levelBudgetSplitPercent.hazard / 100)),
  resources: Math.round(REFERENCE_BUDGET_TOKENS * (BASE_COSTS.levelBudgetSplitPercent.resource / 100)),
});

/** Target delver/warden spend ratio (design §3.2): 200/250 = 0.8. */
export const TARGET_DELVER_WARDEN_RATIO = 0.8;

/**
 * Flat default pool weights derived from the two-tier defaults.
 * rooms: 0.55*0.80=0.44, hazards: 0.15*0.80=0.12, wardens: 0.20*0.80=0.16,
 * resources: 0.10*0.80=0.08, delver: 0.20
 */
/**
 * DERIVED from `base-costs.json`, not restated here.
 *
 * The base-cost standard is "numbers in JSON, formulas in code", and this was numbers in
 * code: a second Allocator-side split beside `levelBudgetSplitPercent`, byte-identical to
 * it until CR.9 M5 retuned the JSON and only the JSON moved. Two numbers for one policy is
 * the CR.1 defect however few files it spans, and the pool ids are the only genuine
 * difference — the JSON speaks the card-type vocabulary (`room`, `warden`, …) and the
 * pools speak the pool vocabulary (`rooms`, `wardens`, …), so the mapping is the formula
 * and lives here while the numbers live there.
 */
const POOL_ID_BY_CARD_TYPE = Object.freeze({
  room: { id: "rooms", notes: "Rooms / layout / hazards" },
  hazard: { id: "hazards", notes: "Hazard elements" },
  warden: { id: "wardens", notes: "Warden actors" },
  resource: { id: "resources", notes: "Resource drops" },
  delver: { id: "delver", notes: "Delver actors" },
});

const DEFAULT_POOLS = Object.freeze(
  Object.entries(POOL_ID_BY_CARD_TYPE).map(([cardType, { id, notes }]) => ({
    id,
    weight: (BASE_COSTS.levelBudgetSplitPercent[cardType] ?? 0) / 100,
    notes,
  })),
);

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
