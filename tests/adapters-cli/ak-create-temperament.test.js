// ak create `temperament=` on delver and warden specs (#675): the level keeps each actor's
// temperament beside the roster (`temperaments`), the receipt charges n² × 5 for it, and a
// value that is not a whole number is refused.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const FLOOR = "vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";

function create(args) {
  const dir = mkdtempSync(join(tmpdir(), "ak-create-temperament-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=medium;count=2", ...args,
    "--budget-tokens", "8000", "--created-at", "2026-11-08T00:00:00.000Z", "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { result, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("temperament= is kept beside the roster and charged on the receipt", () => {
  const run = create([
    "--delver", `count=1;id=hero;affinity=wind;motivation=exploring+strategy_focused;${FLOOR};temperament=2`,
    "--warden", "count=1;id=boss;affinity=fire;motivation=exploring;temperament=1",
    "--warden", "count=1;id=calm;affinity=fire;motivation=exploring;temperament=0",
  ]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const state = run.read("initial-state.json");
    assert.deepEqual(state.temperaments, { "hero-1": 2, "boss-1": 1 });
    const lines = run.read("budget-receipt.json").lineItems.filter((line) => line.id === "actor_temperament")
      .map((line) => [line.subjectRef.id, line.totalCost]);
    assert.deepEqual(lines.sort(), [["boss-1", 5], ["hero-1", 20]]);
  } finally {
    run.cleanup();
  }
});

test("a temperament that is not a whole number is refused", () => {
  const run = create(["--delver", `count=1;id=hero;affinity=wind;motivation=exploring;${FLOOR};temperament=1.5`]);
  try {
    assert.notEqual(run.result.status, 0);
    assert.match(run.result.stderr + run.result.stdout, /temperament must be a whole number/);
  } finally {
    run.cleanup();
  }
});

// ## TODO: Test Permutations
// - temperament=-1 is refused the same way
// - temperament on a count=3 card gives each actor the same temperament
