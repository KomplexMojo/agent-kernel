/**
 * #422 — level difficulty grades H (easiest) to S (ultra hard). The Allocator owns the
 * table (base-costs.json): each grade is a budget and a dungeon/delver split, applied to
 * the build's pools so the delver pool holds the delver share. `ak create --grade` (and
 * `grade` on ak_create) sets both; an explicit --budget-tokens wins and is reported.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const CREATED_AT = "2026-10-24T00:00:00.000Z";

async function pricing() {
  const { createAllocatorPersona } = await import("../../../packages/runtime/src/personas/allocator/controller.js");
  return createAllocatorPersona({ clock: () => CREATED_AT }).pricing;
}

function create(args) {
  const dir = mkdtempSync(join(os.tmpdir(), "ak-grade-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--created-at", CREATED_AT, "--out-dir", dir, ...args], { encoding: "utf8" });
  const line = result.stdout.trim().split("\n").at(-1) || "{}";
  let parsed = {};
  try { parsed = JSON.parse(line); } catch { parsed = { ok: false, error: result.stdout + result.stderr }; }
  return { dir, result: parsed, ok: result.status === 0 && parsed.ok !== false, stderr: result.stderr };
}
const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), "utf8"));

test("the grade table: H..S, budgets rising, the dungeon share growing to S's 80%", async () => {
  const { levelGrades, levelGrade } = await pricing();
  assert.deepEqual(levelGrades(), ["H", "G", "F", "E", "D", "C", "B", "A", "S"]);
  assert.deepEqual(levelGrades().map((id) => levelGrade(id).budgetTokens),
    [1000, 1350, 1800, 2350, 3100, 4100, 5450, 7100, 9450]);
  assert.deepEqual(levelGrades().map((id) => levelGrade(id).dungeonPercent), [50, 50, 55, 55, 60, 60, 65, 65, 80]);
  assert.equal(levelGrade("c").grade, "C", "case does not matter");
  assert.throws(() => levelGrade("Z"), /unknown level grade "Z"; known grades: H, G, F, E, D, C, B, A, S/);
});

test("a grade re-weights the pools: the delver pool holds the delver share, dungeon pools keep their ratio", async () => {
  const { levelGradePoolWeights } = await pricing();
  const weights = [{ id: "rooms", weight: 0.27 }, { id: "hazards", weight: 0.15 }, { id: "wardens", weight: 0.24 }, { id: "delver", weight: 0.25 }];
  const graded = levelGradePoolWeights(weights, "S");
  const share = (id) => graded.find((pool) => pool.id === id).weight;
  assert.ok(Math.abs(share("delver") - 0.2) < 1e-9);
  assert.ok(Math.abs(share("rooms") + share("hazards") + share("wardens") - 0.8) < 1e-9);
  assert.ok(Math.abs(share("rooms") / share("hazards") - 0.27 / 0.15) < 1e-9);
  const onlyDungeon = [{ id: "rooms", weight: 0.27 }];
  assert.deepEqual(levelGradePoolWeights(onlyDungeon, "S"), onlyDungeon, "a side with no pool leaves the weights alone");
});

// Darren's calibration: a light delver does about two things, with low vitals and regen.
// The kinds are only data; every affinity is a peer.
const light = (id, motivation) => `count=1;id=${id};affinity=decay;affinities=decay:push:2:2,light:emit:2:2;equip=decay:push;motivation=${motivation};vitals=health:10:1,mana:20:2,stamina:10:1,durability:10:1`;
const delvers = (count) => Array.from({ length: count }, (_, index) => ["--delver", light(`d${index}`, index === 0 ? "user_controlled" : "exploring")]).flat();

test("grade H: two light delvers fit the 500-token delver share, three do not", () => {
  const two = create(["--grade", "H", "--room", "size=small;count=1", ...delvers(2)]);
  assert.equal(two.ok, true, JSON.stringify(two.result));
  const pools = readJson(two.dir, "budget-receipt.json").poolStatuses;
  assert.equal(pools.find((pool) => pool.id === "delver").capTokens, 500);
  const three = create(["--grade", "H", "--room", "size=small;count=1", ...delvers(3)]);
  assert.equal(three.ok, false, "three light delvers overspend the H delver share");
  assert.match(JSON.stringify(three.result) + three.stderr, /delver/);
});

test("the grade is stamped on the level and the receipt, and echoed in the result", () => {
  const built = create(["--grade", "D", "--room", "size=small;count=1", ...delvers(1)]);
  assert.equal(built.ok, true, JSON.stringify(built.result));
  assert.equal(readJson(built.dir, "sim-config.json").meta.cost.grade, "D");
  assert.equal(readJson(built.dir, "sim-config.json").meta.cost.budgetTokens, 3100);
  assert.equal(readJson(built.dir, "budget-receipt.json").meta.cost.grade, "D");
  assert.deepEqual(built.result.grade, { grade: "D", budgetTokens: 3100, dungeonPercent: 60, delverPercent: 40 });
});

test("an explicit --budget-tokens wins over the grade's and is reported as an override", () => {
  const built = create(["--grade", "H", "--budget-tokens", "1200", "--room", "size=small;count=1", ...delvers(1)]);
  assert.equal(built.ok, true, JSON.stringify(built.result));
  assert.equal(built.result.grade.budgetOverride, 1200);
  assert.equal(readJson(built.dir, "sim-config.json").meta.cost.budgetTokens, 1200);
});

test("an unknown grade is refused, naming the known ones", () => {
  const built = create(["--grade", "Z", "--room", "size=small;count=1"]);
  assert.equal(built.ok, false);
  assert.match(JSON.stringify(built.result) + built.stderr, /known grades: H, G, F, E, D, C, B, A, S/);
});

// Every grade builds a feasible level; the affinities rotate so every kind is used.
const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
test.each(KINDS.map((kind, index) => [["H", "G", "F", "E", "D", "C", "B", "A", "S"][index % 9], kind]))(
  "grade %s builds a feasible level (%s)", (grade, kind) => {
    const built = create(["--grade", grade, "--room", "size=medium;count=1",
      "--hazard", `affinity=${kind};expression=emit;stacks=1;proximityRadius=1`,
      "--warden", `count=1;affinity=${kind};motivation=defending`,
      "--delver", `count=1;affinity=${kind};motivation=user_controlled`]);
    assert.equal(built.ok, true, JSON.stringify(built.result));
    assert.equal(readJson(built.dir, "budget-receipt.json").status, "approved");
  });

test("grade S gives the dungeon side at least 75% of the budget", () => {
  const built = create(["--grade", "S", "--room", "size=medium;count=2",
    "--hazard", "affinity=water;expression=emit;stacks=1;proximityRadius=1",
    "--warden", "count=2;affinity=earth;motivation=defending",
    "--resource", "permanenceMode=consumable;vital=health;delta=5",
    "--delver", "count=1;affinity=wind;motivation=user_controlled"]);
  assert.equal(built.ok, true, JSON.stringify(built.result));
  const pools = readJson(built.dir, "budget-receipt.json").poolStatuses;
  const dungeon = pools.filter((pool) => pool.id !== "delver").reduce((sum, pool) => sum + pool.capTokens, 0);
  const total = pools.reduce((sum, pool) => sum + pool.capTokens, 0);
  assert.ok(dungeon / total >= 0.75, `${dungeon} of ${total}`);
});

// ## TODO: Test Permutations
// - each grade x each affinity (the rotation above covers every grade and every kind once)
// - ak_create's `grade` field maps to --grade and returns the same result
// - a playtest built with --grade records the grade in its report and rebuilds with it (--open)
