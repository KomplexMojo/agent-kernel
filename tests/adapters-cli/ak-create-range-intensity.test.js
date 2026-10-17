// #343: `ak create` authors an affinity's range and intensity (#340). `affinities=` takes
// kind:expression:range:intensity on delvers and wardens, a hazard takes stacks=<range>;intensity=<n>,
// and both reach the initial state core loads. Omitted, intensity stays absent (core reads 1).
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function create(args) {
  const dir = mkdtempSync(join(tmpdir(), "ak-create-intensity-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=small;count=2", ...args,
    "--created-at", "2026-10-17T00:00:00.000Z", "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { result, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("delvers, wardens and hazards carry the authored range and intensity into the level", () => {
  const run = create([
    "--delver", "count=1;affinity=fire;motivation=exploring+user_controlled;affinities=fire:push:6:2,light:emit:2;equip=fire:push",
    "--warden", "count=1;affinity=dark;motivation=stationary;affinities=dark:emit:1:3",
    "--hazard", "affinity=water;expression=emit;stacks=2;intensity=3;proximityRadius=1;mana=regen:30:30:3",
  ]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const actors = Object.fromEntries(run.read("initial-state.json").actors.map((actor) => [actor.id, actor.affinities]));
    assert.deepEqual(actors["card_delver_1-1"], [
      { kind: "fire", expression: "push", stacks: 6, intensity: 2 },
      { kind: "light", expression: "emit", stacks: 2 },
    ], "an affinity without an intensity carries none");
    assert.deepEqual(actors["card_warden_1-1"], [{ kind: "dark", expression: "emit", stacks: 1, intensity: 3 }]);
    assert.deepEqual(actors.hazard_1, [{ kind: "water", expression: "emit", stacks: 2, intensity: 3 }]);
  } finally {
    run.cleanup();
  }
});

test("an intensity that is not a whole number from 1 up is refused", () => {
  for (const [flag, spec, message] of [
    ["--delver", "count=1;affinity=fire;affinities=fire:push:6:0", /delver\[1\] affinity\[1\] intensity must be a positive integer/],
    ["--delver", "count=1;affinity=fire;affinities=fire:push:6:1.5", /delver\[1\] affinity\[1\] intensity must be a positive integer/],
    ["--delver", "count=1;affinity=fire;affinities=fire:push:6:2:9", /must be kind\[:expression\[:range\[:intensity\]\]\]/],
    ["--hazard", "affinity=water;expression=emit;intensity=0;proximityRadius=1", /hazard\[1\] intensity must be a positive integer/],
  ]) {
    const run = create([flag, spec]);
    try {
      assert.notEqual(run.result.status, 0, spec);
      assert.match(run.result.stdout + run.result.stderr, message);
    } finally {
      run.cleanup();
    }
  }
});

// ## TODO: Test Permutations
// - a positioned hazard (x=;y=) carries intensity the same way.
// - the same kind:expression given twice adds its range and keeps the stronger intensity.
// - ak_create (MCP) with a structured delver object carrying intensity reaches the same initial state.
