// ak create `strategy=` on delver and warden specs (Phase 2b), end to end: the level carries
// each actor's strategy beside the roster, the create result reports the parts an actor's
// thinking will not follow and the targets the level lacks, and malformed ones are refused.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const FLOOR = "vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";

function create(args) {
  const dir = mkdtempSync(join(tmpdir(), "ak-create-strategy-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=medium;count=2", ...args,
    "--budget-tokens", "8000", "--created-at", "2026-10-14T00:00:00.000Z", "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  const json = result.stdout.trim() ? JSON.parse(result.stdout.trim().split("\n").at(-1)) : null;
  return { result, json, read, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("compact goals reach every actor a card makes, beside the roster", () => {
  const run = create([
    "--delver", `count=1;id=hero;affinity=wind;motivation=user_controlled+exploring;${FLOOR}`,
    "--delver", `count=2;id=pal;affinity=earth;motivation=exploring+goal_oriented;${FLOOR};strategy=follow:hero-1:2,reach:exit`,
  ]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const goals = [{ kind: "follow", target: "hero-1", distance: 2 }, { kind: "reach", place: "exit" }];
    assert.deepEqual(run.read("initial-state.json").strategies, { "pal-1": { goals }, "pal-2": { goals } });
    assert.equal(run.json.strategyReport, undefined, "goal_oriented follows goals: nothing to report");
  } finally {
    run.cleanup();
  }
});

test("a JSON strategy file carries tactics; parts an actor ignores and unknown targets are reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "ak-strategy-file-"));
  const file = join(dir, "guard.json");
  writeFileSync(file, JSON.stringify({
    goals: [{ kind: "guard", target: "hero-1", radius: 3 }],
    tactics: [{ when: { vital: "health", below: 40 }, do: { kind: "retreat" } }],
  }));
  const run = create([
    "--delver", `count=1;id=hero;affinity=wind;motivation=user_controlled;${FLOOR}`,
    "--delver", `count=1;id=sharp;affinity=earth;motivation=exploring+strategy_focused;${FLOOR};strategy=${file}`,
    "--delver", `count=1;id=plain;affinity=earth;motivation=exploring+goal_oriented;${FLOOR};strategy=${file}`,
    "--warden", `count=1;id=keeper;affinity=fire;motivation=stationary;strategy=defeat:ghost`,
  ]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.deepEqual(run.read("initial-state.json").strategies["sharp-1"].tactics,
      [{ when: { vital: "health", below: 40 }, do: { kind: "retreat" } }]);
    const byActor = (left, right) => (left.actorId < right.actorId ? -1 : 1);
    assert.deepEqual([...run.json.strategyReport].sort(byActor), [
      { actorId: "keeper-1", depth: "none", ignored: ["goals"], unknownTargets: ["ghost"] },
      { actorId: "plain-1", depth: "goals", ignored: ["tactics"] },
    ]);
  } finally {
    run.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed strategy is refused with its reason", () => {
  for (const [strategy, reason] of [
    ["dance:hero-1", /unknown kind "dance"/],
    ["reach:here", /place must be exit or <x>\/<y>/],
    ["hold:2/2", /hold ticks/],
    ['{"goals":[{"kind":"follow"}]}', /follow needs a target/],
  ]) {
    const run = create(["--delver", `count=1;id=pal;affinity=earth;motivation=exploring+goal_oriented;${FLOOR};strategy=${strategy}`]);
    try {
      assert.notEqual(run.result.status, 0, `${strategy} is refused`);
      assert.match(`${run.result.stderr}${run.result.stdout}`, reason);
    } finally {
      run.cleanup();
    }
  }
});

// ## TODO: Test Permutations
// - strategy= on a warden spec with a guard goal on another warden.
// - a strategy file that is not JSON, and a missing one: refused with the path.
// - lead:<id>:<distance>, survive:<distance>, take:<id> and guard:<id> without a radius.
// - ak create --dry-run with strategy= reports the same strategyReport.
