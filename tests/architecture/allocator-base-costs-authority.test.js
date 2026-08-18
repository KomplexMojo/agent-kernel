/**
 * G1 allocator/base-costs (A2) — THE NINE, paperwork six, 2026-08-18.
 *
 * `base-costs.json` already has two guards: `single-origin.test.js` forbids any file
 * other than `default-price-list.js` from reading it, and `pricing-authority.test.js`
 * forbids any OTHER module from declaring a numeric price literal at all. Together they
 * prove nothing else CAN read or duplicate these numbers. What the roster's
 * `KNOWN_UNREGISTERED` note names as unasked is the forward direction: does the price
 * list production actually issues come FROM this file, or could `default-price-list.js`
 * drift — a hardcoded number sitting beside a JSON read, exactly the `cost-model.js`
 * shape `single-origin.test.js`'s own comment records as this repo's recurring failure?
 *
 * So this is a FIDELITY check, not a boundary check: read base-costs.json independently
 * of the ES module import (plain fs + JSON.parse), and require every emitted price-list
 * item's unitCost to equal a value traceable to that independent read — either directly
 * (the eight priced groups) or through the one documented transform (the free-floating
 * resource premium, itself Allocator-authored logic per default-price-list.js's own
 * "DATA vs LOGIC" header, not a second data source).
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const BASE_COSTS_PATH = resolve(
  ROOT,
  "packages/runtime/src/personas/allocator/base-costs.json",
);
const QUADRATIC_IDS = new Set([
  "vital_health_regen_tick",
  "vital_mana_regen_tick",
  "vital_stamina_regen_tick",
  "vital_durability_regen_tick",
  "affinity_stack",
]);
const KIND_BY_GROUP = {
  vitals: "vital",
  regen: "vital",
  affinity: "affinity",
  motivation: "motivation",
  actor: "actor",
  tile: "tile",
  hazard: "hazard",
  resource: "resource",
};

function readRawBaseCosts() {
  return JSON.parse(readFileSync(BASE_COSTS_PATH, "utf8"));
}

/**
 * Independently-derived expected items, from the raw JSON alone — not by importing
 * default-price-list.js. Mirrors the ONE documented transform (the resource premium,
 * rounded) rather than re-executing production's code, so this remains a check ON that
 * code rather than a copy of it.
 */
function expectedDirectItems(raw) {
  const items = {};
  for (const [group, entries] of Object.entries(raw)) {
    if (!(group in KIND_BY_GROUP) || typeof entries !== "object") continue;
    for (const [id, unitCost] of Object.entries(entries)) items[id] = unitCost;
  }
  return items;
}

function expectedResourceMirrors(raw) {
  const premium = raw.freeFloatingPremium;
  const mirrored = [
    ...Object.keys(raw.affinity),
    ...Object.keys(raw.vitals),
    ...Object.keys(raw.regen),
  ];
  const items = {};
  for (const baseId of mirrored) {
    const group = ["affinity", "vitals", "regen"].find((g) => baseId in raw[g]);
    const base = raw[group][baseId];
    items[`resource_${baseId}`] = Math.round(base * premium);
  }
  return items;
}

test("every priced group's numbers are present in base-costs.json (precondition)", () => {
  const raw = readRawBaseCosts();
  const direct = expectedDirectItems(raw);
  assert.ok(Object.keys(direct).length >= 20, "expected at least 20 direct priced ids across 8 groups");
});

test("buildDefaultPriceList's direct items match base-costs.json exactly, id for id", async () => {
  const { buildDefaultPriceList } = await import(
    "../../packages/runtime/src/personas/allocator/default-price-list.js"
  );
  const raw = readRawBaseCosts();
  const expectedDirect = expectedDirectItems(raw);
  const { items } = buildDefaultPriceList();
  const byId = Object.fromEntries(items.map((item) => [item.id, item.unitCost]));

  for (const [id, expectedCost] of Object.entries(expectedDirect)) {
    assert.equal(
      byId[id],
      expectedCost,
      `item ${id}: unitCost ${byId[id]} does not match base-costs.json's ${expectedCost} — `
        + "either the item was hand-edited or a second source fed it",
    );
  }
});

test("buildDefaultPriceList's resource-premium mirrors match the documented transform", async () => {
  const { buildDefaultPriceList } = await import(
    "../../packages/runtime/src/personas/allocator/default-price-list.js"
  );
  const raw = readRawBaseCosts();
  const expectedMirrors = expectedResourceMirrors(raw);
  const { items } = buildDefaultPriceList();
  const byId = Object.fromEntries(items.map((item) => [item.id, item.unitCost]));

  assert.ok(Object.keys(expectedMirrors).length > 0, "precondition: mirrors must exist or this is vacuous");
  for (const [id, expectedCost] of Object.entries(expectedMirrors)) {
    assert.equal(
      byId[id],
      expectedCost,
      `resource mirror ${id}: unitCost ${byId[id]} does not match `
        + `round(base-costs.json base × freeFloatingPremium) = ${expectedCost}`,
    );
  }
});

test("no priced id in base-costs.json is silently dropped from the price list", async () => {
  const { buildDefaultPriceList } = await import(
    "../../packages/runtime/src/personas/allocator/default-price-list.js"
  );
  const raw = readRawBaseCosts();
  const expectedIds = new Set([
    ...Object.keys(expectedDirectItems(raw)),
    ...Object.keys(expectedResourceMirrors(raw)),
  ]);
  const { items } = buildDefaultPriceList();
  const actualIds = new Set(items.map((item) => item.id));

  const missing = [...expectedIds].filter((id) => !actualIds.has(id));
  assert.deepEqual(missing, [], "a base-costs.json id has no corresponding price-list item");
});
