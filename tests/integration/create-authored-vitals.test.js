// #371: `ak create` keeps the vitals an author wrote. The movement and cast floors fill only
// what was left unset (a stamina regen or mana max of 0); a value the author set stands, even
// when it means resting longer between steps or never affording a cast. A floor that still has
// to raise a value someone set (a pool too small for one step, the viability floor) does so in
// the open: the create result lists it under vitalsReport.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AK_CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function create(args) {
  const outDir = mkdtempSync(join(tmpdir(), "ak-vitals-"));
  try {
    const result = spawnSync(process.execPath, [
      AK_CLI, "create", "--room", "size=small;count=1", ...args,
      "--out-dir", outDir, "--run-id", "vitals_probe", "--created-at", "2026-10-18T00:00:00.000Z",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
    const initialState = JSON.parse(readFileSync(join(outDir, "initial-state.json"), "utf8"));
    return {
      summary: JSON.parse(result.stdout.trim().split("\n").pop()),
      vitals: Object.fromEntries(initialState.actors.map((actor) => [actor.id, actor.vitals])),
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test("an authored stamina regen below one move's cost is kept, for delvers and wardens alike", () => {
  const { vitals, summary } = create([
    "--delver", "count=1;id=a;affinity=wind;motivation=exploring;vitals=health:30:2,mana:30:3,stamina:10:1,durability:10:1",
    "--warden", "count=1;id=w;affinity=earth;motivation=patrolling;vitals=health:30:2,mana:30:3,stamina:10:1,durability:10:1",
  ]);
  assert.deepEqual(vitals["a-1"].stamina, { current: 10, max: 10, regen: 1 });
  assert.deepEqual(vitals["w-1"].stamina, { current: 10, max: 10, regen: 1 });
  assert.equal(summary.vitalsReport, undefined, "nothing set was changed, so nothing is reported");
});

test("an authored mana pool smaller than one cast is kept", () => {
  const { vitals } = create([
    "--delver", "count=1;id=a;affinity=fire;affinities=fire:push:6:2;equip=fire:push;motivation=exploring;vitals=health:30:2,mana:30:3,stamina:10:2,durability:10:1",
  ]);
  assert.deepEqual(vitals["a-1"].mana, { current: 30, max: 30, regen: 3 });
});

test("vitals left unset still get the movement and cast floors", () => {
  const { vitals } = create([
    "--warden", "count=1;id=w;affinity=fire;affinities=fire:push:6:2;equip=fire:push;motivation=patrolling",
  ]);
  assert.deepEqual(vitals["w-1"].stamina, { current: 2, max: 2, regen: 2 });
  assert.ok(vitals["w-1"].mana.max > 30, JSON.stringify(vitals["w-1"].mana));
});

test("a delver pool too small for one step is refused with the reason", () => {
  const outDir = mkdtempSync(join(tmpdir(), "ak-vitals-"));
  try {
    const result = spawnSync(process.execPath, [
      AK_CLI, "create", "--room", "size=small;count=1", "--out-dir", outDir,
      "--delver", "count=1;id=a;affinity=wind;motivation=exploring;vitals=health:30:2,mana:30:3,stamina:1:1,durability:10:1",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /movement requires stamina\.max >= 2/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("a set value the viability floor raises is reported, never changed silently", () => {
  const { vitals, summary } = create([
    "--warden", "count=1;id=w;affinity=wind;motivation=patrolling;vitals=health:5:1,mana:30:3,stamina:10:1,durability:10:1",
  ]);
  assert.equal(vitals["w-1"].health.max, 10);
  assert.deepEqual(summary.vitalsReport, [
    { actorId: "w-1", vital: "health", field: "max", set: 5, built: 10, floor: "viability" },
  ]);
});

// ## TODO: Test Permutations
// - a warden whose authored mana max is 0 with an affinity gets the cast floor
// - an authored stamina regen of 0 on a mover is filled to one move's cost
// - configure reports vitalsReport the same way create does
// - the MCP ak_create result carries vitalsReport
