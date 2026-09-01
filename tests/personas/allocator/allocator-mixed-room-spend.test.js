/**
 * RB3.2 — Allocator-owned mixed-room design-token breakdown.
 */
"use strict";

const assert = require("node:assert/strict");

const META = Object.freeze({
  id: "rb3_2_prices",
  runId: "rb3_2",
  createdAt: "2026-09-01T00:00:00.000Z",
  producedBy: "allocator",
});

const ROOM = Object.freeze({ id: "R-fire", width: 6, height: 4 });

const COMPOSITION = Object.freeze({
  templateId: "R-FIRE",
  templateInstanceId: "R-FIRE-1",
  localizedTiles: [],
  localizedHazards: [
    {
      id: "fire_emit",
      affinity: { kind: "fire", expression: "emit", stacks: 1 },
      vitals: {
        mana: { max: 9, regen: 3 },
        durability: { max: 5, regen: 0 },
      },
    },
  ],
});

async function allocator() {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  return createAllocatorPersona({ priceListMeta: META, clock: () => META.createdAt });
}

test("Allocator publishes the signed 88-token mixed-room breakdown from its price list", async () => {
  const persona = await allocator();

  assert.deepEqual(persona.priceMixedRoomDesignSpend({ room: ROOM, composition: COMPOSITION }), {
    status: "available",
    unit: "design_tokens",
    producedBy: "allocator",
    components: {
      defaultTiles: 24,
      localizedTiles: 0,
      roomWideOverlay: 0,
      localizedHazards: 64,
    },
    total: 88,
  });
});

test("mixed-room pricing uses the caller-resolved list and keeps tiles partitioned", async () => {
  const persona = await allocator();
  const priceList = persona.resolvePriceList({
    items: [
      { id: "tile_floor", kind: "tile", unitCost: 2, formula: "linear" },
      { id: "tile_hallway", kind: "tile", unitCost: 3, formula: "linear" },
    ],
  });
  const composition = {
    ...COMPOSITION,
    localizedTiles: [{ x: 1, y: 1, kind: "hallway" }],
    roomWideOverlay: { kind: "fire", expression: "emit", stacks: 1 },
  };

  const result = persona.priceMixedRoomDesignSpend({
    room: ROOM,
    composition,
    priceList,
  });

  assert.deepEqual(result.components, {
    defaultTiles: 46,
    localizedTiles: 3,
    roomWideOverlay: 36,
    localizedHazards: 64,
  });
  assert.equal(result.total, 149);
});

test("mixed-room pricing refuses malformed partitions and incomplete prices", async () => {
  const persona = await allocator();
  const duplicateTile = {
    ...COMPOSITION,
    localizedTiles: [
      { x: 1, y: 1, kind: "floor" },
      { x: 1, y: 1, kind: "hallway" },
    ],
  };
  const incompletePriceList = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: META,
    items: [{ id: "tile_floor", kind: "tile", unitCost: 1, formula: "linear" }],
  };

  assert.deepEqual(
    persona.priceMixedRoomDesignSpend({ room: ROOM, composition: duplicateTile }),
    {
      status: "unavailable",
      unit: "design_tokens",
      producedBy: "allocator",
      reason: "mixed_room_input_invalid",
    },
  );
  assert.deepEqual(
    persona.priceMixedRoomDesignSpend({
      room: ROOM,
      composition: COMPOSITION,
      priceList: incompletePriceList,
    }),
    {
      status: "unavailable",
      unit: "design_tokens",
      producedBy: "allocator",
      reason: "mixed_room_price_missing",
    },
  );
});

// ## TODO: Test Permutations
// - an out-of-bounds localized tile or unsupported affinity expression is unavailable
// - multiple localized hazards and overlays reconcile without sharing quadratic quantities
