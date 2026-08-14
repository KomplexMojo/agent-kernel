// D8-V 2026-08-08: `normalizeLayoutCounts` and `sumLayoutTiles` were declared here and are
// now imported. Counting tiles is vocabulary — it prices nothing — and the maintainer's call
// was to move it out of the persona layer rather than publish it on a controller. This file
// keeps what actually is the Allocator's: what a tile COSTS, and whether a layout fits.
import {
  LAYOUT_TILE_FIELDS as SHARED_LAYOUT_TILE_FIELDS,
  LAYOUT_TILE_PRICE_IDS as SHARED_LAYOUT_TILE_PRICE_IDS,
  normalizeLayoutCounts,
} from "../../contracts/domain-constants.js";
import { buildPriceMap } from "./validate-spend.js";
import { buildDefaultPriceList } from "./default-price-list.js";
import { UNUSED_CLOCK } from "../_shared/require-clock.js";

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

/**
 * Raised when a layout must be priced and no price source was supplied.
 *
 * CR.1's last census entry, resolved as decision D-o rather than as a retune. There used
 * to be a `DEFAULT_LAYOUT_TILE_COSTS` in `contracts/domain-constants.js` (floor 1,
 * hallway 1) alongside `base-costs.json` (floor 1, hallway 3): two codebooks, different
 * numbers, and nothing that could notice. Aligning them would have left the second origin
 * in place, free to diverge again the next time either was edited.
 *
 * So there is no default. Tile prices come from the Allocator's PriceList — injected, or
 * the persona's own default list — and their absence is loud, exactly as with
 * `allocator_room_geometry_required`. The charter's wording is the test: "an incomplete
 * price list is a structured error, never a quiet default."
 */
export class AllocatorTilePriceError extends Error {
  constructor() {
    super(
      "Allocator cannot price a layout without tile prices: pass a `priceList` (or explicit "
      + "`tileCosts`). There is deliberately no default — a second origin for a price is the "
      + "CR.1 defect class, and it stays invisible because the resulting spend is well-formed.",
    );
    this.name = "AllocatorTilePriceError";
    this.code = "allocator_tile_price_required";
  }
}

const LAYOUT_TILE_FIELDS = SHARED_LAYOUT_TILE_FIELDS;
const TILE_PRICE_IDS = SHARED_LAYOUT_TILE_PRICE_IDS;

function isInteger(value) {
  return Number.isInteger(value);
}

/**
 * Explicit per-field costs, every field required.
 *
 * Previously this spread a default and let a caller override one field, so a partial
 * `tileCosts` silently priced the rest from contracts. With the default gone there is
 * nothing to fall back TO, and a partial override is a caller bug rather than a shape
 * this can complete.
 */
function normalizeLayoutCosts(layoutCosts) {
  if (!layoutCosts || typeof layoutCosts !== "object" || Array.isArray(layoutCosts)) {
    throw new AllocatorTilePriceError();
  }
  const costs = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    const value = layoutCosts[field];
    if (!isInteger(value) || value <= 0) {
      throw new AllocatorTilePriceError();
    }
    costs[field] = value;
  });
  return costs;
}

/**
 * One line item per tile field, so a receipt accounts for the whole charge.
 *
 * CR.9 M5 removed a `.filter((field) => field !== "hallwayTiles")` here. Hallway tiles
 * were priced in `base-costs.json` and excluded from billing at this exact line — a
 * published price with no charging path, which is M4's dead-vocabulary defect one layer
 * down. Connector tiles reach this function as `hallwayTiles` and are now charged.
 */
function buildLayoutLineItems(layoutCounts, tileCosts) {
  if (!layoutCounts || !tileCosts) return [];
  return LAYOUT_TILE_FIELDS
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

/**
 * Read every tile price out of a PriceList, completing it from the Allocator's own
 * default list where the caller's list is silent.
 *
 * ⚠️ READ THIS BEFORE "TIGHTENING" IT. There are two different things here and CR.1 is
 * only about one of them:
 *
 *   A SECOND TABLE is the defect. `contracts/domain-constants.js` used to hold its own
 *   tile costs (floor 1, hallway 1) beside `base-costs.json` (floor 1, hallway 3) —
 *   two answers to one question, disagreeing, with nothing able to notice. Deleted.
 *
 *   AN OVERRIDE IS NOT. A caller may price some ids and not others; the CLI documents
 *   exactly that ("`tile_hallway` items (kind `tile`) override the defaults"), and the
 *   UI prices card sets with no list at all. Completing those from `base-costs.json`
 *   reads from the ONE origin — it does not create a second one.
 *
 * So the missing price falls back to the canonical list, and the refusal is reserved for
 * a caller that supplies `tileCosts` explicitly and supplies them wrong (below): claiming
 * to set a price and not setting it is a caller bug, not an omission.
 */
export function resolveLayoutTileCosts(priceList) {
  const priceMap = buildPriceMap(priceList);
  const defaults = buildPriceMap(buildDefaultPriceList({ createdAt: UNUSED_CLOCK() }));
  const costs = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    const mapping = TILE_PRICE_IDS[field];
    if (!mapping) return;
    const key = `${mapping.kind}:${mapping.id}`;
    const cost = priceMap.get(key);
    // SILENT vs ABSENT — a distinction the first pass collapsed, found by the Codex
    // adversarial review. A list that does not mention a tile is silent, and the canonical
    // list answers (the documented override shape). A list that PRICES a tile at zero or a
    // negative number has spoken, and substituting a default there would quietly overrule
    // an explicit caller value — and would hand back a free tile, which is the exact
    // exploit "everything costs something" exists to prevent. Say so instead.
    if (priceMap.has(key) && !(Number.isFinite(cost) && cost > 0)) {
      throw new AllocatorTilePriceError();
    }
    const resolved = Number.isFinite(cost) && cost > 0 ? cost : defaults.get(key);
    if (!Number.isFinite(resolved) || resolved <= 0) {
      // Only reachable if base-costs.json itself stops pricing a tile field — i.e. the
      // single origin is incomplete, which is the loud case the charter demands.
      throw new AllocatorTilePriceError();
    }
    costs[field] = Math.floor(resolved);
  });
  return { costs, warnings: undefined };
}

export function evaluateLayoutSpend({ layout, budgetTokens, priceList, tileCosts } = {}) {
  const warnings = [];
  const normalized = normalizeLayoutCounts(layout, warnings);
  // CR.9 M5: a `deprecated_hallway_tiles_ignored` branch used to zero this count before
  // pricing. Hallways were therefore free wherever they were counted, while the price
  // list went on publishing a cost for them. They are walkable area and are charged.
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
      // No default to fall back on (CR.1): resolve the real prices, or refuse.
      tileCosts: tileCosts ? normalizeLayoutCosts(tileCosts) : resolveLayoutTileCosts(priceList).costs,
      lineItems: [],
      warnings: undefined,
      overBudget: false,
    };
  }
  // CR.9 M5 — CONNECTORS ARE CHARGED. `billableFloorTiles` counts room interiors only;
  // `connectorFloorTiles` (8/16/24 per small/medium/large card) was excluded from it, so
  // roughly a quarter of every level's walkable area was built for free. The Configurator
  // publishes both counts; deciding that both are billable is Allocator policy, and this
  // is where it is decided. Connectors are priced as hallway tiles, which now cost what a
  // floor tile costs — so the split is a receipt-legibility choice, not a price difference.
  const billableFloorTiles = Number.isInteger(layout.billableFloorTiles) && layout.billableFloorTiles > 0
    ? layout.billableFloorTiles
    : Number.isInteger(layout.floorTiles)
      ? layout.floorTiles
      : 0;
  const connectorFloorTiles = Number.isInteger(layout.connectorFloorTiles) && layout.connectorFloorTiles > 0
    ? layout.connectorFloorTiles
    : 0;
  const result = evaluateLayoutSpend({
    layout: {
      floorTiles: billableFloorTiles,
      hallwayTiles: connectorFloorTiles,
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

// D8-V: `export const LAYOUT_TILE_PRICE_IDS = TILE_PRICE_IDS` and `export { LAYOUT_TILE_FIELDS }`
// stood here as re-exports of contracts vocabulary. Their last consumer (`layout-fit.js`) now
// reads contracts directly, so they are deleted rather than kept "for compatibility" — a
// persona re-exporting contracts is the laundering hop P5.1 catalogued five times.
