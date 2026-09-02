/**
 * inventory-summary-model.js
 *
 * The view-model behind the toggleable inventory screen.
 *
 * Grouping, ordering, labels, icon identity and token arithmetic are semantics,
 * so they live here rather than in the renderer — the same reason
 * `actor-hud-model.js` does. The Phaser shelf rail derives an equivalent shape
 * inline today; this is the single origin both surfaces can read, so a summary
 * and the rail beside it cannot disagree about what is in the inventory.
 *
 * Output is plain serializable data: no functions, no class instances.
 *
 * @module inventory-summary-model
 */

import { GAME_COLOR_PALETTE } from "../contracts/game-elements.js";
import { buildActorHudModel } from "./actor-hud-model.js";

/** Canonical display order, matching the Phaser shelf rail. */
export const INVENTORY_TYPE_ORDER = Object.freeze([
  "room",
  "delver",
  "warden",
  "hazard",
  "resource",
]);

/**
 * Which icon category each inventory type resolves through. `hazard` and
 * `resource` are items rather than actor types, and the icon model distinguishes
 * them, so the summary has to say which bucket it means.
 */
const ICON_CATEGORY = Object.freeze({
  room: "types",
  delver: "types",
  warden: "types",
  hazard: "items",
  resource: "items",
});

const LABEL = Object.freeze({
  room: "Rooms",
  delver: "Delvers",
  warden: "Wardens",
  hazard: "Hazards",
  resource: "Resources",
});

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colourFor(type) {
  return GAME_COLOR_PALETTE.types?.[type] || GAME_COLOR_PALETTE.items?.[type] || "#8a8588";
}

/**
 * @typedef {object} InventoryGroup
 * @property {string} type
 * @property {string} label
 * @property {number} count
 * @property {number} allocatedTokens
 * @property {number} usedTokens
 * @property {number} remainingTokens  May be negative — overspend is real state.
 * @property {string} colorHex
 * @property {string} iconCategory
 * @property {Array<{id: string, tokens: number, count: number, hud: object|null}>} cards
 */

/**
 * Build the inventory summary.
 *
 * @param {{ cards?: unknown, allocationLedger?: object }} [input]
 * @returns {{ groups: InventoryGroup[], unknown: Array<{id: string, type: string}>,
 *             totals: { cardCount: number, allocatedTokens: number, usedTokens: number,
 *                       remainingTokens: number, overspent: boolean } }}
 */
export function buildInventorySummary({ cards, allocationLedger } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const byType = allocationLedger?.byType && typeof allocationLedger.byType === "object"
    ? allocationLedger.byType
    : {};

  const buckets = Object.fromEntries(INVENTORY_TYPE_ORDER.map((t) => [t, []]));
  const unknown = [];
  for (const card of list) {
    const type = typeof card?.type === "string" ? card.type.trim().toLowerCase() : "";
    const entry = {
      id: typeof card?.id === "string" ? card.id : "",
      tokens: finite(card?.tokens),
      count: Math.max(1, Math.round(finite(card?.count, 1))),
      // The same view-model the board HUD uses, so an inventory row and the HUD
      // cannot describe the same entity differently.
      hud: buildActorHudModel(card),
    };
    if (buckets[type]) buckets[type].push(entry);
    // Surfaced rather than dropped: a card the summary cannot place is a real
    // discrepancy between the inventory and what the board will show.
    else unknown.push({ ...entry, type });
  }

  const groups = INVENTORY_TYPE_ORDER.map((type) => {
    const alloc = byType[type] || {};
    const allocatedTokens = finite(alloc.allocatedTokens);
    const usedTokens = finite(alloc.usedTokens);
    return {
      type,
      label: LABEL[type] || type,
      count: buckets[type].length,
      allocatedTokens,
      usedTokens,
      // Not clamped. Overspend is real state, and hiding it behind Math.max
      // turns a budget error into a display that looks correct.
      remainingTokens: allocatedTokens - usedTokens,
      colorHex: colourFor(type),
      iconCategory: ICON_CATEGORY[type],
      cards: buckets[type],
    };
  });

  // Totals are summed from the rows, never counted separately: a total computed
  // its own way is a total that can disagree with the rows above it.
  const totals = groups.reduce(
    (acc, g) => ({
      cardCount: acc.cardCount + g.count,
      allocatedTokens: acc.allocatedTokens + g.allocatedTokens,
      usedTokens: acc.usedTokens + g.usedTokens,
      remainingTokens: acc.remainingTokens + g.remainingTokens,
    }),
    { cardCount: 0, allocatedTokens: 0, usedTokens: 0, remainingTokens: 0 },
  );
  totals.cardCount += unknown.length;
  totals.overspent = groups.some((g) => g.remainingTokens < 0);

  return { groups, unknown, totals };
}
