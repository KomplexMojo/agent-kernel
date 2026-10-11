/**
 * Leftover tiles-grid billing: when unified layouts drop `tiles`, countFloorTiles
 * fell through to width × height and billed walls as floors (I4: 484 vs 50).
 * Terrain floor cells are the lossless leftover-glyph equivalent (. not #/S/E).
 * Do not invent prices.
 */
const assert = require("node:assert/strict");

const META = Object.freeze({
  id: "terrain-floor-spend",
  runId: "terrain_floor_spend",
  createdAt: "2026-09-20T00:00:00.000Z",
  producedBy: "allocator",
});

async function load() {
  const { buildSpendProposal } = await import(
    "../../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/persona.js"
  );
  const normalizeMotivations = createConfiguratorPersona({
    clock: () => META.createdAt,
  }).normalizeMotivations;
  return {
    charge: (payload) => buildSpendProposal({ meta: META, normalizeMotivations, ...payload }),
  };
}

test("terrain layouts bill floor cells, not leftover width times height", async () => {
  const { charge } = await load();
  const terrain = [
    "wall", "wall", "wall", "wall", "wall",
    "wall", "spawn", "floor", "exit", "wall",
    "wall", "floor", "floor", "floor", "wall",
    "wall", "wall", "wall", "wall", "wall",
  ];
  const spend = charge({ layout: { width: 5, height: 4, terrain } });
  const floorItem = (spend.items || []).find((item) => item.id === "tile_floor");
  assert.equal(floorItem?.quantity, 4, "spawn/exit/wall are not leftover-billed as floor");
  assert.notEqual(floorItem?.quantity, 20, "width × height must not replace leftover tiles");
});

// ## TODO: Test Permutations
// - leftover tiles grid still counts non-#/S/E glyphs when terrain is absent
// - explicit floorTiles still wins over terrain
// - empty terrain array bills zero floors instead of falling through to width × height
