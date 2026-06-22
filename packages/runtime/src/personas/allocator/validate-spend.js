const BUDGET_RECEIPT_ARTIFACT_SCHEMA = "agent-kernel/BudgetReceiptArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";
const BUDGET_ARTIFACT_SCHEMA = "agent-kernel/BudgetArtifact";

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

function normalizeQuantity(value) {
  if (!isFiniteNumber(value)) return 1;
  return value <= 0 ? 1 : value;
}

export function validateSpendProposal({
  budget,
  priceList,
  proposal,
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
      return {
        id: String(id || "unknown"),
        kind: String(kind || "unknown"),
        quantity,
        unitCost: 0,
        totalCost: 0,
        status: "denied",
        ...(typeof item?.category === "string" ? { category: item.category } : {}),
      };
    }

    const key = `${kind}:${id}`;
    const legacyKey = `legacy:${id}`;
    const price = priceMap.get(key) || priceMap.get(legacyKey);
    if (!price) {
      errors.push(`Unknown price item: ${kind}:${id}`);
      return {
        id,
        kind,
        quantity,
        unitCost: 0,
        totalCost: 0,
        status: "denied",
        ...(typeof item?.category === "string" ? { category: item.category } : {}),
      };
    }

    const totalCost = price.unitCost * quantity;
    const lineItem = {
      id,
      kind,
      quantity,
      unitCost: price.unitCost,
      totalCost,
      status: "approved",
    };
    // Pass through attribution fields from the proposal item if present
    if (typeof item.category === "string") lineItem.category = item.category;
    if (item.artifactRef != null) lineItem.artifactRef = item.artifactRef;
    if (item.subjectRef != null) lineItem.subjectRef = item.subjectRef;
    if (item.detail !== undefined) lineItem.detail = item.detail;
    return lineItem;
  });

  const totalCost = lineItems.reduce((sum, item) => sum + item.totalCost, 0);
  const remaining = isFiniteNumber(budgetTokens) ? budgetTokens - totalCost : 0;

  let status = "approved";
  if (!Number.isInteger(budgetTokens)) {
    errors.push("Invalid budget tokens.");
    status = "denied";
  }

  const hasDenied = lineItems.some((item) => item.status !== "approved");
  if (hasDenied && status !== "denied") {
    status = lineItems.some((item) => item.status === "approved") ? "partial" : "denied";
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
      status,
      totalCost,
      remaining,
      lineItems,
    },
    errors: errors.length ? errors : undefined,
  };
}
