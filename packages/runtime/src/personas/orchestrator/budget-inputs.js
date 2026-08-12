import { requireClock, UNUSED_CLOCK } from "../_shared/require-clock.js";

/**
 * CR.7 / WP-5 — the fallback price list comes from the ALLOCATOR's public surface.
 *
 * This module imported `allocator/default-price-list.js` directly: the Orchestrator holding a
 * route to pricing data, which "Economy — Allocator Authority" forbids. `pricing.priceList()`
 * returns the injected list or the default, so it is the same answer through the owner.
 *
 * BEHAVIOUR-IDENTICAL, and that is not a guess: `buildDefaultPriceList({ meta, createdAt })`
 * uses `createdAt` only in its `meta || { … }` fallback branch, and this caller always supplies
 * `meta`. So the `UNUSED_CLOCK` the persona needs at construction cannot reach the artifact.
 */
import { createAllocatorPersona } from "../allocator/persona.js";

const buildDefaultPriceList = ({ meta }) => createAllocatorPersona({
  priceListMeta: meta,
  clock: UNUSED_CLOCK,
}).pricing.priceList();
import {
  BUDGET_ARTIFACT_SCHEMA as BUDGET_SCHEMA,
  PRICE_LIST_SCHEMA,
} from "../../contracts/artifacts.ts";

function buildMeta(meta = {}, { producedBy = "orchestrator", runId = "run_orchestrator", clock, idPrefix = "artifact" } = {}) {
  if (meta.id && meta.runId && meta.createdAt && meta.producedBy) {
    return meta;
  }
  // PX.3: required only when minting (see llm-capture.js for the same shape).
  const createdAt = meta.createdAt || requireClock(clock, "orchestrator")();
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

function normalizePriceListInput({ priceListInput, meta, metaDefaults, useFallback = false }) {
  if (!priceListInput) {
    if (useFallback) {
      return {
        priceList: buildDefaultPriceList({ meta: buildMeta(meta, metaDefaults) }),
        errors: [],
        isDefault: true,
      };
    }
    return { priceList: null, errors: [] };
  }
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
  clock,
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
    useFallback: !!budgetResult.budget && !sourcePriceList,
  });

  if (!budgetResult.budget) {
    errors.push("Missing budget input.");
  }
  // Price list is no longer required — the default is used when omitted alongside a budget.
  errors.push(...budgetResult.errors, ...priceResult.errors);

  return {
    budget: budgetResult.budget,
    priceList: priceResult.priceList,
    errors: errors.length ? errors : undefined,
  };
}
