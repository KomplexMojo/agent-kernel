import {
  DEFAULT_LAYOUT_TILE_COSTS as SHARED_DEFAULT_LAYOUT_TILE_COSTS,
  LAYOUT_TILE_FIELDS as SHARED_LAYOUT_TILE_FIELDS,
  LAYOUT_TILE_PRICE_IDS as SHARED_LAYOUT_TILE_PRICE_IDS,
} from "../../contracts/domain-constants.js";

const LAYOUT_TILE_FIELDS = SHARED_LAYOUT_TILE_FIELDS;
const DEFAULT_TILE_COSTS = SHARED_DEFAULT_LAYOUT_TILE_COSTS;
const TILE_PRICE_IDS = SHARED_LAYOUT_TILE_PRICE_IDS;

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
  const wallTiles = normalizeTileCount(layout.wallTiles, "wallTiles", warnings);
  if (wallTiles > 0) {
    const floorTiles = counts.floorTiles || 0;
    const hallwayTiles = counts.hallwayTiles || 0;
    const walkableTiles = floorTiles + hallwayTiles;
    if (walkableTiles > 0) {
      const floorShare = Math.floor((wallTiles * floorTiles) / walkableTiles);
      const hallwayShare = wallTiles - floorShare;
      counts.floorTiles = floorTiles + floorShare;
      counts.hallwayTiles = hallwayTiles + hallwayShare;
    } else {
      const floorShare = Math.ceil(wallTiles / 2);
      counts.floorTiles = floorShare;
      counts.hallwayTiles = wallTiles - floorShare;
    }
    if (warnings) {
      warnings.push({
        code: "deprecated_wall_tiles_redistributed",
        detail: {
          wallTiles,
          floorTiles: counts.floorTiles,
          hallwayTiles: counts.hallwayTiles,
        },
      });
    }
  }
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
  return (layout.floorTiles || 0) + (layout.hallwayTiles || 0);
}

export function evaluateLayoutSpend({ layout, budgetTokens, priceList, tileCosts } = {}) {
  const warnings = [];
  const normalized = normalizeLayoutCounts(layout, warnings);
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
    warnings: warnings.length > 0 ? warnings : undefined,
    overBudget,
  };
}

export const LAYOUT_TILE_PRICE_IDS = TILE_PRICE_IDS;
export const DEFAULT_LAYOUT_TILE_COSTS = DEFAULT_TILE_COSTS;
export { LAYOUT_TILE_FIELDS };
