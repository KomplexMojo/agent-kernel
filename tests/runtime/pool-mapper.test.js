const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");

test("mapSummaryToPool snaps to nearest entry and generates stable IDs", async () => {
  const { mapSummaryToPool } = await import("../../packages/runtime/src/personas/director/pool-mapper.js");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

  const summary = {
    rooms: [{ motivation: "stationary", affinity: "fire", count: 2, tokenHint: 250 }],
    actors: [
      { motivation: "attacking", affinity: "fire", count: 1, tokenHint: 250 },
      { motivation: "defending", affinity: "earth", count: 2, tokenHint: 200 },
    ],
  };

  const result = mapSummaryToPool({ summary, catalog });
  assert.equal(result.ok, true);
  assert.equal(result.selections.length, 3);

  const roomSel = result.selections.find((s) => s.kind === "room");
  assert.equal(roomSel.applied.cost, 200);
  assert.equal(roomSel.instances.length, 2);
  assert.equal(roomSel.instances[0].id, "actor_stationary_fire_200_1");

  const attackSel = result.selections.find((s) => s.requested.motivation === "attacking");
  assert.equal(attackSel.applied.cost, 200);
  assert.equal(attackSel.receipt.status, "downTiered");

  const defendSel = result.selections.find((s) => s.requested.motivation === "defending");
  assert.equal(defendSel.applied.cost, 120);
  assert.equal(defendSel.instances.length, 2);
});

test("mapSummaryToPool reports missing when no match and propagates catalog errors", async () => {
  const { mapSummaryToPool } = await import("../../packages/runtime/src/personas/director/pool-mapper.js");
  const badCatalog = { entries: [{ id: "x" }] };
  const resBad = mapSummaryToPool({ summary: {}, catalog: badCatalog });
  assert.equal(resBad.ok, false);
  assert.ok(resBad.errors.length > 0);

  const emptyCatalog = { entries: [] };
  const resMissing = mapSummaryToPool({
    summary: { actors: [{ motivation: "attacking", affinity: "fire", count: 1 }] },
    catalog: emptyCatalog,
  });
  assert.equal(resMissing.ok, true);
  assert.equal(resMissing.selections[0].receipt.status, "missing");
});

test("mapSummaryToPool snaps arbitrary token hints down deterministically", async () => {
  const { mapSummaryToPool } = await import("../../packages/runtime/src/personas/director/pool-mapper.js");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const summary = {
    actors: [{ motivation: "defending", affinity: "earth", count: 1, tokenHint: 175 }],
  };
  const result = mapSummaryToPool({ summary, catalog });
  assert.equal(result.ok, true);
  const sel = result.selections[0];
  assert.equal(sel.applied.cost, 120); // snap down from 175 to nearest <=
  assert.equal(sel.receipt.status, "downTiered");
});
