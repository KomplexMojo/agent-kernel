/**
 * Slot-unlock loot (maintainer, 2026-10-12) was retired on 2026-10-30 (Darren): `ak create
 * --resource "slots=1"` is refused, and the Configurator still refuses a slot holding on any
 * preset but a resource.
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

// Darren, 2026-10-30: an actor equips at most three affinities and carries the rest as a pack,
// so slot-unlock loot is retired: the Configurator refuses it.
test("ak create refuses slot loot: it is retired", () => {
  const { result } = create("slots=1;id=slot_cache");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /slots= is retired/);
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
// - a resource combining a vital payload and slots is refused too
// - resource-plan --resource "slots=1" is refused the same way
