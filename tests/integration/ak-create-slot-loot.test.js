/**
 * Slot-unlock loot (maintainer, 2026-10-12) was retired on 2026-10-30 (Darren) and its
 * machinery removed (#577): `ak create --resource "slots=1"` is refused.
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

// ## TODO: Test Permutations
// - a resource combining a vital payload and slots is refused too
// - resource-plan --resource "slots=1" is refused the same way
