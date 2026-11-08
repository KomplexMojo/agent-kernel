// agon create `leader=` on delver and warden specs (#408): the level binds each minion to its
// leader beside the roster (`leaders`), stamps `minionOf` for core, and refuses an unknown leader.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/agon.mjs");
const FLOOR = "vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";

function create(args) {
  const dir = mkdtempSync(join(tmpdir(), "agon-create-leader-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=medium;count=2", ...args,
    "--budget-tokens", "8000", "--created-at", "2026-11-08T00:00:00.000Z", "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { result, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("leader= binds every actor a card makes, on delvers and wardens", () => {
  const run = create([
    "--delver", `count=1;id=hero;affinity=wind;motivation=user_controlled;${FLOOR}`,
    "--delver", `count=2;id=imp;affinity=earth;motivation=friendly;${FLOOR};leader=hero-1`,
    "--warden", "count=1;id=boss;affinity=fire;motivation=exploring",
    "--warden", "count=1;id=thrall;affinity=fire;motivation=exploring;leader=boss-1",
  ]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const state = run.read("initial-state.json");
    assert.deepEqual(state.leaders, { "imp-1": "hero-1", "imp-2": "hero-1", "thrall-1": "boss-1" });
    assert.equal(state.actors.find((actor) => actor.id === "thrall-1").minionOf, "boss-1");
  } finally {
    run.cleanup();
  }
});

test("a leader naming no actor in the level is refused", () => {
  const run = create([
    "--delver", `count=1;id=hero;affinity=wind;motivation=user_controlled;${FLOOR}`,
    "--delver", `count=1;id=imp;affinity=earth;motivation=friendly;${FLOOR};leader=ghost`,
  ]);
  try {
    assert.notEqual(run.result.status, 0);
    assert.match(`${run.result.stderr}${run.result.stdout}`, /leader "ghost"/);
  } finally {
    run.cleanup();
  }
});

// ## TODO: Test Permutations
// - leader= through agon_create (MCP) gives the same level
// - leader= and escort= naming different actors: the leader wins
