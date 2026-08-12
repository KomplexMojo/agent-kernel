const BUDGET_RECEIPT_ARTIFACT_SCHEMA = "agent-kernel/BudgetReceiptArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";
const BUDGET_ARTIFACT_SCHEMA = "agent-kernel/BudgetArtifact";
const BUDGET_ALLOCATION_SCHEMA = "agent-kernel/BudgetAllocationArtifact";

const CATEGORY_POOL_IDS = Object.freeze({
  rooms: "rooms",
  floor_tiles: "rooms",
  hazards: "rooms",
  hazards: "hazards",
  resources: "resources",
  delvers: "delver",
  wardens: "wardens",
  shared_system: "rooms",
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function buildRef(artifact, fallbackSchema) {
  const meta = artifact?.meta;
  if (meta?.id && artifact?.schema && artifact?.schemaVersion) {
    return { id: meta.id, schema: artifact.schema, schemaVersion: artifact.schemaVersion };
  }
  return { id: meta?.id || "unknown", schema: fallbackSchema, schemaVersion: 1 };
}

export function normalizePriceItems(priceList) {
  const items = Array.isArray(priceList?.items) ? priceList.items : [];
  const map = new Map();
  items.forEach((item) => {
    if (typeof item?.id === "string" && typeof item?.kind === "string") {
      // Canonical shape: unitCost takes precedence over legacy costTokens field
      const rawCost = isFiniteNumber(item?.unitCost) ? item.unitCost
        : isFiniteNumber(item?.costTokens) ? item.costTokens
        : null;
      if (rawCost !== null && rawCost >= 0) {
        map.set(`${item.kind}:${item.id}`, {
          unitCost: rawCost,
          kind: item.kind,
          id: item.id,
          formula: item.formula || "linear",
        });
        return;
      }
    }
    if (typeof item?.key === "string" && isFiniteNumber(item?.unitCost)) {
      map.set(`legacy:${item.key}`, { unitCost: item.unitCost, kind: "legacy", id: item.key, formula: "linear" });
    }
  });
  return map;
}

export function buildPriceMap(priceList) {
  const normalized = normalizePriceItems(priceList);
  const map = new Map();
  for (const [key, entry] of normalized) {
    if (typeof key === "string" && key.includes(":") && !key.startsWith("legacy:")) {
      map.set(key, entry.unitCost);
    }
  }
  return map;
}

export function calculatePriceTotal(price, quantity) {
  const unitCost = isFiniteNumber(price?.unitCost) ? price.unitCost : 0;
  const q = normalizeQuantity(quantity);
  return price?.formula === "quadratic" ? unitCost * q * q : unitCost * q;
}

function buildAllocationRef(allocation) {
  return allocation ? buildRef(allocation, BUDGET_ALLOCATION_SCHEMA) : undefined;
}

function buildAllocationAudit({ allocation, lineItems, errors }) {
  const pools = Array.isArray(allocation?.pools) ? allocation.pools : [];
  if (pools.length === 0) return undefined;

  const spendByPool = new Map(pools.map((pool) => [pool.id, 0]));
  lineItems.forEach((item) => {
    const poolId = CATEGORY_POOL_IDS[item.category];
    if (!poolId) {
      item.status = "denied";
      errors.push(`Unattributed spend item: ${item.kind}:${item.id}`);
      return;
    }
    spendByPool.set(poolId, (spendByPool.get(poolId) || 0) + item.totalCost);
  });

  const poolStatuses = pools.map((pool) => {
    const capTokens = Number.isInteger(pool.tokens) ? pool.tokens : 0;
    const spentTokens = spendByPool.get(pool.id) || 0;
    const remainingTokens = capTokens - spentTokens;
    const status = remainingTokens >= 0 ? "approved" : "denied";
    if (status === "denied") {
      errors.push(`Pool ${pool.id} exceeds allocation: spent ${spentTokens}, cap ${capTokens}.`);
      lineItems.forEach((item) => {
        if (CATEGORY_POOL_IDS[item.category] === pool.id) item.status = "denied";
      });
    }
    return {
      id: pool.id,
      capTokens,
      spentTokens,
      remainingTokens,
      status,
    };
  });

  return { poolStatuses };
}

function normalizeQuantity(value) {
  if (!isFiniteNumber(value)) return 1;
  return value <= 0 ? 1 : value;
}

function copyAttribution(item, lineItem) {
  if (typeof item?.category === "string") lineItem.category = item.category;
  if (item?.artifactRef != null) lineItem.artifactRef = item.artifactRef;
  if (item?.subjectRef != null) lineItem.subjectRef = item.subjectRef;
  if (item?.detail !== undefined) lineItem.detail = item.detail;
  return lineItem;
}

export function validateSpendProposal({
  budget,
  priceList,
  proposal,
  allocation,
  meta,
  budgetRef,
  priceListRef,
  proposalRef,
} = {}) {
  const errors = [];
  const budgetTokens = budget?.budget?.tokens;
  const priceMap = normalizePriceItems(priceList);
  const items = Array.isArray(proposal?.items) ? proposal.items : [];

  const lineItems = items.map((item) => {
    const id = item?.id;
    const kind = item?.kind;
    const quantity = normalizeQuantity(item?.quantity);
    if (typeof id !== "string" || typeof kind !== "string") {
      errors.push(`Invalid proposal item: ${JSON.stringify(item)}`);
      return copyAttribution(item, {
        id: String(id || "unknown"),
        kind: String(kind || "unknown"),
        quantity,
        unitCost: 0,
        totalCost: 0,
        status: "denied",
      });
    }

    const key = `${kind}:${id}`;
    const legacyKey = `legacy:${id}`;
    const price = priceMap.get(key) || priceMap.get(legacyKey);
    if (!price) {
      errors.push(`Unknown price item: ${kind}:${id}`);
      return copyAttribution(item, {
        id,
        kind,
        quantity,
        unitCost: 0,
        totalCost: 0,
        status: "denied",
      });
    }

    const totalCost = calculatePriceTotal(price, quantity);
    const lineItem = {
      id,
      kind,
      quantity,
      unitCost: price.unitCost,
      totalCost,
      status: "approved",
    };
    return copyAttribution(item, lineItem);
  });

  const totalCost = lineItems.reduce((sum, item) => sum + item.totalCost, 0);
  const remaining = isFiniteNumber(budgetTokens) ? budgetTokens - totalCost : 0;
  const allocationAudit = buildAllocationAudit({ allocation, lineItems, errors });

  let status = "approved";
  if (!Number.isInteger(budgetTokens)) {
    errors.push("Invalid budget tokens.");
    status = "denied";
  }

  const hasDenied = lineItems.some((item) => item.status !== "approved");
  if (hasDenied && status !== "denied") {
    status = allocation ? "denied" : lineItems.some((item) => item.status === "approved") ? "partial" : "denied";
  }

  if (status !== "denied" && Number.isInteger(budgetTokens) && totalCost > budgetTokens) {
    errors.push("Total cost exceeds budget.");
    status = "denied";
    lineItems.forEach((item) => {
      item.status = "denied";
    });
  }

  return {
    receipt: {
      schema: BUDGET_RECEIPT_ARTIFACT_SCHEMA,
      schemaVersion: 1,
      meta,
      budgetRef: budgetRef || buildRef(budget, BUDGET_ARTIFACT_SCHEMA),
      priceListRef: priceListRef || buildRef(priceList, PRICE_LIST_SCHEMA),
      proposalRef,
      ...(allocation ? { allocationRef: buildAllocationRef(allocation) } : {}),
      status,
      totalCost,
      remaining,
      lineItems,
      ...(allocationAudit ? allocationAudit : {}),
    },
    errors: errors.length ? errors : undefined,
  };
}
