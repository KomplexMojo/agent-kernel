/**
 * RB3.1 — Allocator-owned build price resolution and actor-expansion availability.
 */
"use strict";

const assert = require("node:assert/strict");

const DEFAULT_META = Object.freeze({
  id: "rb3_default_prices",
  runId: "rb3_build_policy",
  createdAt: "2026-08-31T00:00:00.000Z",
  producedBy: "test",
});

async function allocator() {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  return createAllocatorPersona({ priceListMeta: DEFAULT_META, clock: () => DEFAULT_META.createdAt });
}

test("resolvePriceList preserves default order while explicit keyed items override and append", async () => {
  const persona = await allocator();
  const defaults = persona.pricing.priceList();
  const defaultItem = defaults.items[0];
  const suppliedMeta = { ...DEFAULT_META, id: "rb3_supplied_prices", producedBy: "caller" };
  const override = { ...defaultItem, unitCost: 17, description: "caller override" };
  const appended = { id: "actor_custom", kind: "actor", unitCost: 9, formula: "flat" };
  const legacy = { key: "legacy_custom", unitCost: 4 };
  const supplied = {
    schema: defaults.schema,
    schemaVersion: defaults.schemaVersion,
    meta: suppliedMeta,
    items: [override, appended, legacy],
  };

  const resolved = persona.resolvePriceList(supplied);

  assert.equal(persona.resolvePriceList(), defaults, "no caller list returns the persona default artifact");
  assert.deepEqual(
    persona.resolvePriceList({ items: [] }).meta,
    defaults.meta,
    "an otherwise supplied list without metadata retains canonical metadata",
  );
  assert.deepEqual(resolved.meta, suppliedMeta);
  assert.equal(resolved.items.length, defaults.items.length + 2);
  assert.deepEqual(resolved.items[0], override, "an override keeps the default key's insertion slot");
  assert.deepEqual(resolved.items.slice(-2), [appended, legacy]);
  assert.deepEqual(supplied.items, [override, appended, legacy], "resolution does not mutate caller data");
});

test("resolveActorExpansionAvailability applies the global and actor-pool ceilings", async () => {
  const persona = await allocator();
  const receipt = {
    remaining: 200,
    poolStatuses: [
      { id: "rooms", remainingTokens: 999 },
      { id: "wardens", remainingTokens: 70 },
      { id: "delver", remainingTokens: 50 },
      { id: "resources", remainingTokens: -10 },
    ],
  };

  assert.equal(persona.resolveActorExpansionAvailability({ receipt }), 120);
  assert.equal(
    persona.resolveActorExpansionAvailability({ receipt: { ...receipt, remaining: 100 } }),
    100,
  );
  assert.equal(
    persona.resolveActorExpansionAvailability({ receipt: { remaining: 33 } }),
    33,
    "without pool evidence the global receipt remainder remains authoritative",
  );
  assert.equal(
    persona.resolveActorExpansionAvailability({
      receipt: { remaining: 44, poolStatuses: [{ id: "rooms", remainingTokens: 999 }] },
    }),
    44,
    "a receipt with no actor pools also falls back to the global remainder",
  );
});

// ## TODO: Test Permutations
// - duplicate caller entries for one kind/id retain the last value in the original default slot
// - malformed actor-pool remaining values contribute zero without changing unrelated pools
