// ak create `escort=` on delver and warden specs (#251): the level carries each escort's
// ally and distance beside the roster, keyed by actor id, and an unknown ally is refused.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const FLOOR = "vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";

function create(args) {
  const dir = mkdtempSync(join(tmpdir(), "ak-create-escort-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=medium;count=2", ...args,
    "--budget-tokens", "8000", "--created-at", "2026-10-18T00:00:00.000Z", "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { result, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("escort= reaches every actor a card makes; a bare distance keeps the default ally", () => {
  const run = create([
    "--delver", `count=1;id=hero;affinity=wind;motivation=user_controlled;${FLOOR}`,
    "--delver", `count=2;id=pal;affinity=earth;motivation=escorting;${FLOOR};escort=hero-1:3`,
    "--warden", "count=1;id=keeper;affinity=fire;motivation=escorting;escort=:1",
  ]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.deepEqual(run.read("initial-state.json").escorts, {
      "pal-1": { target: "hero-1", distance: 3 },
      "pal-2": { target: "hero-1", distance: 3 },
      "keeper-1": { distance: 1 },
    });
  } finally {
    run.cleanup();
  }
});

test("an escort naming no actor in the level, or a bad distance, is refused", () => {
  for (const [escort, reason] of [["ghost", /escort ally "ghost"/], ["hero-1:0", /distance/], ["a:b:c", /<id>\[:<distance>\]/]]) {
    const run = create([
      "--delver", `count=1;id=hero;affinity=wind;motivation=user_controlled;${FLOOR}`,
      "--delver", `count=1;id=pal;affinity=earth;motivation=escorting;${FLOOR};escort=${escort}`,
    ]);
    try {
      assert.notEqual(run.result.status, 0, `${escort} is refused`);
      assert.match(`${run.result.stderr}${run.result.stdout}`, reason);
    } finally {
      run.cleanup();
    }
  }
});

// ## TODO: Test Permutations
// - escort= through ak_create (MCP) gives the same level
