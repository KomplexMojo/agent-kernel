const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");

test("normalizePoolCatalog loads and sorts entries deterministically", async () => {
  const { normalizePoolCatalog } = await import(
    "../../packages/runtime/src/personas/configurator/pool-catalog.js"
  );
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const result = normalizePoolCatalog(catalog);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.entries.length, 4);

  const ids = result.entries.map((entry) => entry.id);
  assert.deepEqual(ids, [
    "actor_attacking_fire_200",
    "actor_defending_earth_120",
    "actor_patrolling_wind_80",
    "actor_stationary_fire_200",
  ]);
});

test("normalizePoolCatalog rejects invalid entries", async () => {
  const { normalizePoolCatalog } = await import(
    "../../packages/runtime/src/personas/configurator/pool-catalog.js"
  );
  const result = normalizePoolCatalog({
    entries: [
      { id: "", type: "actor", subType: "dynamic", motivation: "invalid", affinity: "fire", cost: -1 },
      { id: "dup", type: "actor", subType: "dynamic", motivation: "attacking", affinity: "invalid", cost: 10 },
      { id: "dup", type: "actor", subType: "dynamic", motivation: "attacking", affinity: "fire", cost: 10 },
    ],
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.find((e) => e.field === "entries[0].id" && e.code === "invalid_id"));
  assert.ok(result.errors.find((e) => e.field === "entries[0].motivation" && e.code === "invalid_motivation"));
  assert.ok(result.errors.find((e) => e.field === "entries[0].cost" && e.code === "invalid_cost"));
  assert.ok(result.errors.find((e) => e.field === "entries[1].affinity" && e.code === "invalid_affinity"));
  assert.ok(result.errors.find((e) => e.field === "entries[2].id" && e.code === "duplicate_id"));
});
