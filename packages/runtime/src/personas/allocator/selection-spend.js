import { calculateActorConfigurationUnitCost } from "../configurator/spend-proposal.js";

function isInteger(value) {
  return Number.isInteger(value);
}

function buildPriceMap(priceList) {
  const items = Array.isArray(priceList?.items) ? priceList.items : [];
  const map = new Map();
  items.forEach((item) => {
    if (typeof item?.id === "string" && typeof item?.kind === "string" && Number.isFinite(item?.costTokens)) {
      map.set(`${item.kind}:${item.id}`, item.costTokens);
    }
  });
  return map;
}

function deriveSelectionCount(selection) {
  const requested = selection?.requested;
  if (isInteger(requested?.count) && requested.count > 0) {
    return requested.count;
  }
  const instances = Array.isArray(selection?.instances) ? selection.instances : [];
  if (instances.length > 0) {
    return instances.length;
  }
  return 0;
}

function resolveActorCostEntry(selection) {
  if (!selection || typeof selection !== "object") return null;
  const requested = selection.requested && typeof selection.requested === "object"
    ? selection.requested
    : null;
  const firstInstance = Array.isArray(selection.instances) && selection.instances.length > 0
    ? selection.instances[0]
    : null;
  const vitals = requested?.vitals || firstInstance?.vitals;
  const affinities = Array.isArray(requested?.affinities) ? requested.affinities : firstInstance?.affinities;
  if (!vitals && !Array.isArray(affinities)) return null;
  return { vitals, affinities };
}

function deriveSelectionCost(selection, priceMap) {
  const kind = selection?.kind;
  const appliedId = selection?.applied?.id || selection?.requested?.id;
  let baseCost = 0;
  if (kind && appliedId && priceMap?.size) {
    const key = `${kind}:${appliedId}`;
    const override = priceMap.get(key);
    if (Number.isFinite(override) && override > 0) {
      baseCost = override;
    }
  }
  if (!baseCost) {
    const appliedCost = selection?.applied?.cost;
    if (isInteger(appliedCost) && appliedCost > 0) {
      baseCost = appliedCost;
    }
  }
  let configCost = 0;
  let configDetail;
  if (kind === "actor") {
    const entry = resolveActorCostEntry(selection);
    if (entry) {
      const computed = calculateActorConfigurationUnitCost({
        entry,
        priceMap,
      });
      configCost = isInteger(computed?.cost) && computed.cost > 0 ? computed.cost : 0;
      configDetail = computed?.detail;
    }
  }

  return {
    unitCost: baseCost + configCost,
    baseCost,
    configCost,
    configDetail,
  };
}

function cloneSelectionWithCount(selection, count) {
  const next = { ...selection };
  if (selection?.requested && typeof selection.requested === "object") {
    next.requested = { ...selection.requested, count };
  }
  if (Array.isArray(selection?.instances)) {
    next.instances = selection.instances.slice(0, count).map((entry) => ({ ...entry }));
  }
  if (selection?.receipt && typeof selection.receipt === "object") {
    next.receipt = { ...selection.receipt, count };
  }
  return next;
}

export function evaluateSelectionSpend({ selections = [], budgetTokens, priceList } = {}) {
  const warnings = [];
  const decisions = [];
  const approvedSelections = [];
  const rejectedSelections = [];

  const priceMap = buildPriceMap(priceList);
  let remaining = isInteger(budgetTokens) ? budgetTokens : 0;
  if (!isInteger(budgetTokens)) {
    warnings.push({ code: "invalid_budget_tokens" });
  }

  let cheapestRequestedUnitCost = null;
  selections.forEach((selection, index) => {
    const requestedCount = deriveSelectionCount(selection);
    const costInfo = deriveSelectionCost(selection, priceMap);
    const unitCost = costInfo.unitCost;
    const base = {
      index,
      kind: selection?.kind || "unknown",
      id: selection?.applied?.id || selection?.requested?.id || "unknown",
      requestedCount,
      unitCost,
      baseUnitCost: costInfo.baseCost,
      configUnitCost: costInfo.configCost,
      configDetail: costInfo.configDetail,
    };

    if (requestedCount <= 0) {
      decisions.push({ ...base, approvedCount: 0, rejectedCount: 0, status: "skipped" });
      return;
    }
    if (isInteger(unitCost) && unitCost > 0) {
      cheapestRequestedUnitCost = cheapestRequestedUnitCost === null
        ? unitCost
        : Math.min(cheapestRequestedUnitCost, unitCost);
    }
    if (!isInteger(unitCost) || unitCost <= 0) {
      warnings.push({ code: "missing_cost", index, kind: base.kind, id: base.id });
      decisions.push({ ...base, approvedCount: 0, rejectedCount: requestedCount, status: "missing_cost" });
      rejectedSelections.push(cloneSelectionWithCount(selection, requestedCount));
      return;
    }

    const affordable = Math.floor(remaining / unitCost);
    const approvedCount = Math.max(0, Math.min(requestedCount, affordable));
    const rejectedCount = requestedCount - approvedCount;
    remaining -= approvedCount * unitCost;

    if (approvedCount > 0) {
      approvedSelections.push(cloneSelectionWithCount(selection, approvedCount));
    }
    if (rejectedCount > 0) {
      warnings.push({
        code: "trimmed",
        index,
        kind: base.kind,
        id: base.id,
        requested: requestedCount,
        approved: approvedCount,
      });
      rejectedSelections.push(cloneSelectionWithCount(selection, rejectedCount));
    }

    decisions.push({
      ...base,
      approvedCount,
      rejectedCount,
      totalCost: approvedCount * unitCost,
      status: rejectedCount > 0 ? "partial" : "approved",
    });
  });

  const spentTokens = (isInteger(budgetTokens) ? budgetTokens : 0) - remaining;

  return {
    spentTokens,
    remainingBudgetTokens: remaining,
    approvedSelections,
    rejectedSelections,
    cheapestRequestedUnitCost,
    decisions,
    warnings: warnings.length ? warnings : undefined,
  };
}
