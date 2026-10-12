/**
 * Slot-unlock loot end to end (maintainer, 2026-10-12): `ak create --resource
 * "slots=1"` authors a floor resource carrying a slot holding, the Allocator
 * charges it as the most valuable loot, and the Configurator refuses it on any
 * preset but a resource (defeated delvers and wardens never drop slots).
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function create(resource) {
  const dir = mkdtempSync(join(os.tmpdir(), "ak-slot-loot-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=small;count=1",
    "--delver", "count=1;affinity=water;motivation=attacking", "--resource", resource,
    "--budget-tokens", "5000", "--run-id", "slot_loot", "--created-at", "2026-10-12T00:00:00.000Z",
    "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
  return { dir, result };
}
const read = (dir, file) => JSON.parse(readFileSync(join(dir, file), "utf8"));

test("ak create places slot loot as a resource holding and charges it per slot", () => {
  const { dir, result } = create("slots=1;id=slot_cache");
  assert.equal(result.status, 0, result.stderr);
  const cache = read(dir, "initial-state.json").actors.find((actor) => actor.id === "slot_cache");
  assert.deepEqual(cache.holdings, [{ id: "slot:slot_cache", kind: "slot", slots: 1, claimedBy: null }]);
  assert.equal(read(dir, "resource-1.json").slotGrant, 1);
  const line = read(dir, "budget-receipt.json").lineItems.find((item) => item.id === "resource_affinity_slot");
  assert.equal(line.quantity, 1);
  const prices = read(dir, "price-list.json").items;
  const slotPrice = prices.find((item) => item.id === "resource_affinity_slot").unitCost;
  assert.equal(line.totalCost, slotPrice);
  assert.ok(prices.filter((item) => item.kind === "resource" && item.id !== "resource_affinity_slot")
    .every((item) => item.unitCost < slotPrice), "slot loot is the most valuable loot");
});

test("a slots value below one is refused at the CLI", () => {
  const { result } = create("slots=0");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /slots must be >= 1/);
});

test("the Configurator puts slot loot only on resources", async () => {
  const { createConfiguratorPersona } = await import("../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => "2026-10-12T00:00:00.000Z" });
  const vitals = { health: { current: 10, max: 10, regen: 1 } };
  assert.throws(() => configurator.normalizeActorDefinition({ category: "warden", id: "w", position: { x: 0, y: 0 },
    vitals, lifecycle: "defeated", holdings: [{ id: "s", kind: "slot", slots: 1, claimedBy: null }] }), /floor loot/);
});

// ## TODO: Test Permutations
// - slots=2 is charged twice the unit price
// - a resource combining a vital payload and slots carries both holdings
// - resource-plan --resource "slots=1" prices the same line
// - a budget below the slot price denies the resources pool
