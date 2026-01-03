const BUDGET_SCHEMA = "agent-kernel/BudgetArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";

function buildMeta(meta = {}, { producedBy = "orchestrator", runId = "run_orchestrator", clock = () => new Date().toISOString(), idPrefix = "artifact" } = {}) {
  if (meta.id && meta.runId && meta.createdAt && meta.producedBy) {
    return meta;
  }
  const createdAt = meta.createdAt || clock();
  const resolvedRunId = meta.runId || runId;
  const id = meta.id || `${idPrefix}_${resolvedRunId}`;
  return {
    id,
    runId: resolvedRunId,
    createdAt,
    producedBy: meta.producedBy || producedBy,
  };
}

function isBudgetArtifact(value) {
  return value?.schema === BUDGET_SCHEMA && value?.schemaVersion === 1 && value?.budget;
}

function isPriceListArtifact(value) {
  return value?.schema === PRICE_LIST_SCHEMA && value?.schemaVersion === 1 && Array.isArray(value?.items);
}

function normalizeBudgetInput({ budgetInput, ownerRef, meta, metaDefaults }) {
  if (!budgetInput) return { budget: null, errors: [] };
  if (isBudgetArtifact(budgetInput)) {
    if (!budgetInput.budget?.ownerRef && ownerRef) {
      return {
        budget: {
          ...budgetInput,
          budget: { ...budgetInput.budget, ownerRef },
        },
        errors: [],
      };
    }
    return { budget: budgetInput, errors: [] };
  }

  const budgetData = budgetInput.budget && typeof budgetInput.budget === "object" ? budgetInput.budget : budgetInput;
  const tokens = budgetData?.tokens;
  const notes = budgetData?.notes;
  const resolvedOwner = budgetData?.ownerRef || ownerRef;
  const errors = [];
  if (!Number.isInteger(tokens)) {
    errors.push("Budget tokens must be an integer.");
  }

  return {
    budget: {
      schema: BUDGET_SCHEMA,
      schemaVersion: 1,
      meta: buildMeta(meta, metaDefaults),
      budget: {
        tokens,
        ownerRef: resolvedOwner,
        notes,
      },
    },
    errors,
  };
}

function normalizePriceListInput({ priceListInput, meta, metaDefaults }) {
  if (!priceListInput) return { priceList: null, errors: [] };
  if (isPriceListArtifact(priceListInput)) {
    return { priceList: priceListInput, errors: [] };
  }
  const items = priceListInput?.items;
  const errors = [];
  if (!Array.isArray(items) || items.length === 0) {
    errors.push("Price list items must be a non-empty array.");
  }
  return {
    priceList: {
      schema: PRICE_LIST_SCHEMA,
      schemaVersion: 1,
      meta: buildMeta(meta, metaDefaults),
      items: Array.isArray(items) ? items : [],
    },
    errors,
  };
}

export function ingestBudgetInputs({
  budgetInput,
  priceListInput,
  fixtures = {},
  mode = "fixture",
  ownerRef,
  budgetMeta,
  priceListMeta,
  clock = () => new Date().toISOString(),
  runId = "run_orchestrator",
  producedBy = "orchestrator",
} = {}) {
  const metaDefaults = { producedBy, runId, clock };
  const sourceBudget = budgetInput || (mode === "fixture" ? fixtures.budget : null);
  const sourcePriceList = priceListInput || (mode === "fixture" ? fixtures.priceList : null);

  const errors = [];
  const budgetResult = normalizeBudgetInput({
    budgetInput: sourceBudget,
    ownerRef,
    meta: budgetMeta,
    metaDefaults,
  });
  const priceResult = normalizePriceListInput({
    priceListInput: sourcePriceList,
    meta: priceListMeta,
    metaDefaults,
  });

  if (!budgetResult.budget) {
    errors.push("Missing budget input.");
  }
  if (!priceResult.priceList) {
    errors.push("Missing price list input.");
  }
  errors.push(...budgetResult.errors, ...priceResult.errors);

  return {
    budget: budgetResult.budget,
    priceList: priceResult.priceList,
    errors: errors.length ? errors : undefined,
  };
}
