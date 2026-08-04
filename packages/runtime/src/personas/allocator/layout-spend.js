import {
  DEFAULT_LAYOUT_TILE_COSTS as SHARED_DEFAULT_LAYOUT_TILE_COSTS,
  LAYOUT_TILE_FIELDS as SHARED_LAYOUT_TILE_FIELDS,
  LAYOUT_TILE_PRICE_IDS as SHARED_LAYOUT_TILE_PRICE_IDS,
} from "../../contracts/domain-constants.js";
import { buildPriceMap } from "./validate-spend.js";

/**
 * Raised when room-card spend is requested without the Configurator's geometry.
 *
 * CR.9 M2, decision D-o shape: REQUIRED AND THROWING, never a quiet fallback. The
 * Allocator used to import `configurator/card-model.js#deriveLayoutFromRoomCards`
 * and work out the tile count itself — pricing structure it does not own. Now the
 * derivation is injected from the Configurator at the composition root, exactly as
 * CR.6 injects `admitProposals` from the Allocator into the Actor.
 *
 * A default would defeat the point: a second, silently-diverging answer to "how big
 * is this card set" is the CR.1 defect class, and it would be invisible because the
 * output stays well-formed. So a missing capability is a construction error, loud.
 */
export class AllocatorRoomGeometryError extends Error {
  constructor() {
    super(
      "Allocator cannot price a room card without the Configurator's geometry: pass "
      + "{ deriveRoomLayout } from createConfiguratorPersona(). Room tile counts are "
      + "Configurator geometry (card-model.js); the Allocator prices them, it does not "
      + "derive them (finding CR.9).",
    );
    this.name = "AllocatorRoomGeometryError";
    this.code = "allocator_room_geometry_required";
  }
}

function requireRoomGeometry(deriveRoomLayout) {
  if (typeof deriveRoomLayout !== "function") throw new AllocatorRoomGeometryError();
  return deriveRoomLayout;
}

const LAYOUT_TILE_FIELDS = SHARED_LAYOUT_TILE_FIELDS;
const DEFAULT_TILE_COSTS = SHARED_DEFAULT_LAYOUT_TILE_COSTS;
const TILE_PRICE_IDS = SHARED_LAYOUT_TILE_PRICE_IDS;

function isInteger(value) {
  return Number.isInteger(value);
}

function normalizeTileCount(value, field, warnings) {
  if (value === undefined) return 0;
  let parsed = value;
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      parsed = numeric;
    }
  }
  if (!isInteger(parsed) || parsed < 0) {
    if (warnings) warnings.push({ code: "invalid_tile_count", field, value });
    return 0;
  }
  return parsed;
}

export function normalizeLayoutCounts(layout, warnings) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    if (warnings) warnings.push({ code: "invalid_layout" });
    return null;
  }
  const counts = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    counts[field] = normalizeTileCount(layout[field], field, warnings);
  });
  return counts;
}

function normalizeLayoutCosts(layoutCosts) {
  const costs = { ...DEFAULT_TILE_COSTS };
  if (!layoutCosts || typeof layoutCosts !== "object" || Array.isArray(layoutCosts)) {
    return costs;
  }
  LAYOUT_TILE_FIELDS.forEach((field) => {
    const value = layoutCosts[field];
    if (isInteger(value) && value > 0) {
      costs[field] = value;
    }
  });
  return costs;
}

function buildLayoutLineItems(layoutCounts, tileCosts) {
  if (!layoutCounts || !tileCosts) return [];
  return LAYOUT_TILE_FIELDS
    .filter((field) => field !== "hallwayTiles")
    .map((field) => {
      const quantity = Number.isInteger(layoutCounts[field]) ? layoutCounts[field] : 0;
      const unitCostTokens = Number.isInteger(tileCosts[field]) ? tileCosts[field] : 0;
      if (quantity <= 0 || unitCostTokens <= 0) return null;
      return {
        kind: "layout",
        id: field,
        label: field,
        quantity,
        unitCostTokens,
        spendTokens: quantity * unitCostTokens,
      };
    })
    .filter(Boolean);
}

export function resolveLayoutTileCosts(priceList) {
  const warnings = [];
  const priceMap = buildPriceMap(priceList);
  const costs = { ...DEFAULT_TILE_COSTS };
  if (priceMap.size === 0) {
    return { costs, warnings: undefined };
  }
  LAYOUT_TILE_FIELDS.forEach((field) => {
    const mapping = TILE_PRICE_IDS[field];
    if (!mapping) return;
    const key = `${mapping.kind}:${mapping.id}`;
    const cost = priceMap.get(key);
    if (!Number.isFinite(cost) || cost <= 0) {
      warnings.push({ code: "missing_tile_cost", field, id: mapping.id, kind: mapping.kind });
      return;
    }
    costs[field] = Math.floor(cost);
  });
  return { costs, warnings: warnings.length > 0 ? warnings : undefined };
}

export function sumLayoutTiles(layout) {
  if (!layout) return 0;
  return layout.floorTiles || 0;
}

export function evaluateLayoutSpend({ layout, budgetTokens, priceList, tileCosts } = {}) {
  const warnings = [];
  const normalized = normalizeLayoutCounts(layout, warnings);
  if (normalized && Number.isInteger(normalized.hallwayTiles) && normalized.hallwayTiles > 0) {
    warnings.push({ code: "deprecated_hallway_tiles_ignored" });
    normalized.hallwayTiles = 0;
  }
  const costResult = tileCosts
    ? { costs: normalizeLayoutCosts(tileCosts), warnings: undefined }
    : resolveLayoutTileCosts(priceList);
  if (costResult.warnings) warnings.push(...costResult.warnings);

  if (!normalized) {
    return {
      spentTokens: 0,
      remainingBudgetTokens: Number.isInteger(budgetTokens) ? budgetTokens : 0,
      layout: null,
      tileCosts: costResult.costs,
      warnings: warnings.length > 0 ? warnings : undefined,
      overBudget: false,
    };
  }

  const spentTokens = LAYOUT_TILE_FIELDS.reduce(
    (sum, field) => sum + normalized[field] * costResult.costs[field],
    0,
  );
  const lineItems = buildLayoutLineItems(normalized, costResult.costs);
  let remainingBudgetTokens = 0;
  if (!isInteger(budgetTokens)) {
    warnings.push({ code: "invalid_budget_tokens" });
  } else {
    remainingBudgetTokens = Math.max(0, budgetTokens - spentTokens);
  }
  const overBudget = isInteger(budgetTokens) && spentTokens > budgetTokens;
  if (overBudget) {
    warnings.push({ code: "layout_over_budget", detail: { spentTokens, budgetTokens } });
  }

  return {
    spentTokens,
    remainingBudgetTokens,
    layout: normalized,
    tileCosts: costResult.costs,
    lineItems,
    warnings: warnings.length > 0 ? warnings : undefined,
    overBudget,
  };
}

export function evaluateRoomCardLayoutSpend({
  cardSet,
  budgetTokens,
  priceList,
  tileCosts,
  deriveRoomLayout,
} = {}) {
  const layout = requireRoomGeometry(deriveRoomLayout)(cardSet);
  if (!layout) {
    return {
      spentTokens: 0,
      remainingBudgetTokens: Number.isInteger(budgetTokens) ? budgetTokens : 0,
      layout: null,
      tileCosts: tileCosts || { ...DEFAULT_TILE_COSTS },
      lineItems: [],
      warnings: undefined,
      overBudget: false,
    };
  }
  const billableFloorTiles = Number.isInteger(layout.billableFloorTiles) && layout.billableFloorTiles > 0
    ? layout.billableFloorTiles
    : Number.isInteger(layout.floorTiles)
      ? layout.floorTiles
      : 0;
  const result = evaluateLayoutSpend({
    layout: {
      floorTiles: billableFloorTiles,
    },
    budgetTokens,
    priceList,
    tileCosts,
  });
  return {
    ...result,
    layout: {
      floorTiles: Number.isInteger(layout.floorTiles) ? layout.floorTiles : 0,
      connectorFloorTiles: Number.isInteger(layout.connectorFloorTiles) ? layout.connectorFloorTiles : 0,
      billableFloorTiles,
    },
  };
}

export const LAYOUT_TILE_PRICE_IDS = TILE_PRICE_IDS;
export const DEFAULT_LAYOUT_TILE_COSTS = DEFAULT_TILE_COSTS;
export { LAYOUT_TILE_FIELDS };
