/**
 * CR.9 M5 — every tile the level contains is charged, at one published price.
 *
 * MAINTAINER DECISION 2026-08-05: "apply the same default cost to hallway tiles as to
 * room floor tiles... ensure that all costs are recognized and enforced in code."
 *
 * WHAT WAS ACTUALLY WRONG, which is worse than a diverged number:
 *
 *   1. CONNECTOR TILES WERE FREE. `deriveLayoutFromRoomCards` counts 8/16/24 connector
 *      tiles per small/medium/large room card, and `evaluateRoomCardLayoutSpend` charged
 *      `billableFloorTiles`, which excludes them. Every level built from room cards got
 *      a quarter of its walkable area at no cost.
 *   2. HALLWAY TILES WERE PRICED AND UNCHARGEABLE. `base-costs.json` published
 *      `tile_hallway: 3` into every PriceList artifact, while `evaluateLayoutSpend`
 *      ZEROED any hallway count it was given (`deprecated_hallway_tiles_ignored`) and
 *      `buildLayoutLineItems` filtered the field out. A price nothing can charge is the
 *      same defect as M4's published reject reason nothing produces, one layer down.
 *   3. The two codebooks disagreed anyway — `contracts/domain-constants.js` defaulted
 *      hallways to 1, `base-costs.json` said 3 (CR.1's last census entry).
 *
 * So the fix is not a retune. Hallways cost what floors cost, connectors are charged as
 * hallway tiles, and the price list is the only origin of either number.
 *
 * ═══ WHAT HAS TEETH ════════════════════════════════════════════════════════════
 *
 * The charge assertions are the behavior gate. The CENSUS test below is the structural
 * one: it fails if any tile price id in the emitted PriceList cannot appear as a line
 * item. That is what stops a price being published and never charged again — the state
 * this milestone found, which held for the life of the branch under a green suite.
 *
 * PERTURBATION RESULTS 2026-08-05, four restorations, each caught by a different gate:
 *   the contracts tile-cost table (CR.1's defect)   → single-origin price guard
 *   connectors excluded from billing again          → the two charge tests
 *   the hallway line-item filter (priced, uncharged) → the CENSUS test, which is the
 *                                                     only thing that sees this one
 *   base-costs hallway re-diverged to 3             → the price-parity test
 *
 * SCOPE NOTE — the census is tiles only, deliberately. The default list publishes 48 price
 * ids; proving every one is chargeable means driving every charging path, which is its own
 * piece of work. A reachability probe run 2026-08-05 found exactly one further suspect,
 * `hazard_base`, which no code outside the price list mentions (the resource ids that also
 * look unreferenced are constructed dynamically, e.g. `resource_vital_${key}_point`).
 * Recorded in the plan rather than fixed here: deleting or charging it moves the economy,
 * which is a maintainer call, not a cleanup.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/";

async function load() {
  const layoutSpend = await import(`${P}personas/allocator/layout-spend.js`);
  const priceListModule = await import(`${P}personas/allocator/default-price-list.js`);
  const cardModel = await import(`${P}personas/configurator/card-model.js`);
  const priceList = priceListModule.buildDefaultPriceList();
  return {
    ...layoutSpend,
    priceList,
    deriveRoomLayout: cardModel.deriveLayoutFromRoomCards,
    priceOf: (id) => priceList.items.find((item) => item.id === id)?.unitCost,
  };
}

/** One medium room card: 48 room floor tiles + 16 connector tiles, per card-model.js. */
const MEDIUM_ROOM_CARD_SET = Object.freeze([
  { type: "room", size: "medium", count: 1 },
]);

// ── The price: a hallway tile costs what a floor tile costs ───────────────────

test("a hallway tile is priced identically to a floor tile", async () => {
  const { priceOf } = await load();

  assert.equal(priceOf("tile_hallway"), priceOf("tile_floor"));
  assert.equal(
    priceOf("tile_hallway"),
    1,
    "the base unit is 1 point of max health = 1 token; a tile is one unit of walkable area",
  );
});

// ── The charge: connectors are not free ───────────────────────────────────────

test("connector tiles are charged, not donated", async () => {
  const { evaluateRoomCardLayoutSpend, deriveRoomLayout, priceList, priceOf } = await load();

  const geometry = deriveRoomLayout(MEDIUM_ROOM_CARD_SET);
  assert.equal(geometry.connectorFloorTiles, 16, "precondition: a medium card has connectors");

  const spend = evaluateRoomCardLayoutSpend({
    cardSet: MEDIUM_ROOM_CARD_SET,
    budgetTokens: 1000,
    priceList,
    deriveRoomLayout,
  });

  assert.equal(
    spend.spentTokens,
    geometry.floorTiles * priceOf("tile_floor"),
    "every tile in the level is charged: room floor + connectors, at one tile price",
  );
  assert.ok(
    spend.spentTokens > geometry.billableFloorTiles * priceOf("tile_floor"),
    "the old behavior charged billableFloorTiles only, which excluded every connector",
  );
});

test("the connector charge appears as its own line item, so a receipt shows what it bought", async () => {
  const { evaluateRoomCardLayoutSpend, deriveRoomLayout, priceList } = await load();

  const spend = evaluateRoomCardLayoutSpend({
    cardSet: MEDIUM_ROOM_CARD_SET,
    budgetTokens: 1000,
    priceList,
    deriveRoomLayout,
  });

  const byField = new Map(spend.lineItems.map((item) => [item.id, item]));
  assert.equal(byField.get("floorTiles")?.quantity, 48, "room floor tiles");
  assert.equal(byField.get("hallwayTiles")?.quantity, 16, "connectors, charged as hallway tiles");
  assert.equal(
    byField.get("floorTiles").spendTokens + byField.get("hallwayTiles").spendTokens,
    spend.spentTokens,
    "the line items account for the whole charge — a receipt that omits a charge is not a receipt",
  );
});

// ── The deprecation is over: a hallway count survives pricing ─────────────────

test("a hallway count is priced rather than silently zeroed", async () => {
  const { evaluateLayoutSpend, priceList } = await load();

  const spend = evaluateLayoutSpend({
    layout: { floorTiles: 3, hallwayTiles: 2 },
    budgetTokens: 100,
    priceList,
  });

  assert.equal(spend.layout.hallwayTiles, 2, "the count the caller gave is the count that is priced");
  assert.equal(spend.spentTokens, 5);
  assert.ok(
    !(spend.warnings || []).some((warning) => warning.code === "deprecated_hallway_tiles_ignored"),
    "hallway tiles are no longer discarded: they are charged",
  );
});

// ── No silent default: the price list is the only origin ──────────────────────

test("an explicit but incomplete tileCosts is refused rather than quietly completed", async () => {
  const { evaluateLayoutSpend, AllocatorTilePriceError } = await load();

  assert.throws(
    () => evaluateLayoutSpend({
      layout: { floorTiles: 3, hallwayTiles: 3 },
      budgetTokens: 100,
      tileCosts: { floorTiles: 2 },
    }),
    (error) => {
      assert.ok(error instanceof AllocatorTilePriceError);
      assert.equal(error.code, "allocator_tile_price_required");
      return true;
    },
    "this used to spread the contracts default under the caller's partial object, so a "
      + "half-supplied override silently priced the other half from a second table",
  );
});

test("prices omitted by a caller's list come from base-costs, not from a second table", async () => {
  const { evaluateLayoutSpend, priceOf } = await load();

  // A list that prices floor tiles only — the documented CLI override shape.
  const partial = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    items: [{ id: "tile_floor", kind: "tile", unitCost: 7 }],
  };

  const spend = evaluateLayoutSpend({
    layout: { floorTiles: 1, hallwayTiles: 1 },
    budgetTokens: 100,
    priceList: partial,
  });

  assert.equal(spend.tileCosts.floorTiles, 7, "the caller's override wins where it speaks");
  assert.equal(
    spend.tileCosts.hallwayTiles,
    priceOf("tile_hallway"),
    "and where it is silent the ONE canonical list answers — an override is not a second "
      + "origin, which is the distinction CR.1 turns on",
  );
});

// ── CENSUS: a published tile price must be chargeable ─────────────────────────

test("every tile price the Allocator publishes can be charged", async () => {
  const { evaluateLayoutSpend, priceList, LAYOUT_TILE_PRICE_IDS } = await load();

  const publishedTileIds = priceList.items
    .filter((item) => item.kind === "tile")
    .map((item) => item.id)
    .sort();

  // Drive one tile of every field through the pricer and collect what it charged for.
  const layout = Object.fromEntries(Object.keys(LAYOUT_TILE_PRICE_IDS).map((field) => [field, 1]));
  const spend = evaluateLayoutSpend({ layout, budgetTokens: 1000, priceList });
  const chargedTileIds = spend.lineItems
    .map((item) => LAYOUT_TILE_PRICE_IDS[item.id]?.id)
    .filter(Boolean)
    .sort();

  assert.deepEqual(
    chargedTileIds,
    publishedTileIds,
    "a price id with no charging path is dead vocabulary that still reaches every PriceList "
      + "artifact — exactly what tile_hallway was, at a cost nobody could spend, for the life "
      + "of this branch under a green suite",
  );
});

// ## TODO: Test Permutations
