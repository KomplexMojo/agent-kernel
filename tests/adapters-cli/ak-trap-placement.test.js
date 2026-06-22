const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const BUDGET = resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json");
const PRICE_LIST = resolve(ROOT, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

// Shared minimal args that produce a valid single-trap create (dry-run safe).
const BASE_VALID_TRAP_ARGS = [
  "create",
  "--trap", "x=2;y=2;affinity=fire;expression=emit;stacks=1",
  "--delver", "count=1;affinity=fire;motivation=attacking",
  "--budget-tokens", "1000",
  "--budget", BUDGET,
  "--price-list", PRICE_LIST,
];

// ---------------------------------------------------------------------------
// Parse-level rejections — caught before any build or file I/O
// ---------------------------------------------------------------------------

test("trap with negative x is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=-1;y=2;affinity=fire",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] x must be a non-negative integer/i);
});

test("trap with negative y is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=-3;affinity=fire",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] y must be a non-negative integer/i);
});

test("trap with float x is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=1.5;y=2;affinity=fire",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] x/i);
});

test("trap with float y is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2.9;affinity=fire",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] y/i);
});

test("trap with missing affinity is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] affinity must be one of/i);
});

test("trap with unsupported affinity (lightning) is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=lightning",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] affinity must be one of/i);
  assert.match(result.stderr, /fire/);
});

test("trap with zero stacks is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;stacks=0",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] stacks/i);
});

test("trap with unsupported expression is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;expression=blast",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] expression must be one of/i);
});

test("trap with unknown field is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;damage=50",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] field "damage" is not supported/i);
});

test("empty trap spec is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
});

test("trap vital with unsupported kind (health) is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;vitals=health:100:5",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] vital\[1\] has invalid vital kind "health"/i);
});

test("trap vital current exceeding max is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;vitals=mana:200:100:5",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] vital\[1\] current cannot exceed max/i);
});

test("trap vital with wrong part count (only two parts) is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;vitals=mana:100",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] vital\[1\] must be vital:max:regen or vital:current:max:regen/i);
});

// ---------------------------------------------------------------------------
// Size-constraint rejections — caught at the authoring stage (already gated)
// ---------------------------------------------------------------------------

test("trap on a small room is rejected with a clear size error", () => {
  // create --dry-run always exits 0 but returns valid:false + errors when validation fails.
  const result = runCli([
    "create",
    "--room", "size=small;count=1",
    "--trap", "x=2;y=2;affinity=fire",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--dry-run",
  ]);
  assert.equal(result.status, 0);
  const dryRun = JSON.parse((result.stdout || "").trim());
  assert.equal(dryRun.valid, false, "dry-run should report invalid");
  assert.ok(
    dryRun.errors.some((e) => /size=small is too small/i.test(e)),
    `expected small-room error in dry-run errors: ${JSON.stringify(dryRun.errors)}`,
  );
});

// ---------------------------------------------------------------------------
// Valid trap creation — baseline regression
// ---------------------------------------------------------------------------

test("single valid fire trap with mana and durability vitals succeeds", () => {
  const result = runCli([
    ...BASE_VALID_TRAP_ARGS,
    "--dry-run",
  ]);
  if (result.status !== 0) {
    throw new Error(`Expected success, got: ${result.stderr}`);
  }
  const summary = JSON.parse((result.stdout || "").trim());
  assert.equal(summary.ok, true);
});

test("four traps with distinct affinities on different coordinates succeed", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;expression=emit;stacks=2;vitals=mana:100:5,durability:100:5",
    "--trap", "x=4;y=2;affinity=water;expression=emit;stacks=2;vitals=mana:100:5,durability:100:5",
    "--trap", "x=2;y=4;affinity=dark;expression=emit;stacks=2;vitals=mana:100:5,durability:100:5",
    "--trap", "x=4;y=4;affinity=earth;expression=emit;stacks=2;vitals=mana:100:5,durability:100:5",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--dry-run",
  ]);
  if (result.status !== 0) {
    throw new Error(`Expected success, got: ${result.stderr}`);
  }
  const summary = JSON.parse((result.stdout || "").trim());
  assert.equal(summary.ok, true);
});

test("trap vitals accept both max:regen and current:max:regen formats", () => {
  const result = runCli([
    "create",
    "--trap", "x=2;y=2;affinity=fire;vitals=mana:100:5,durability:50:100:3",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--dry-run",
  ]);
  if (result.status !== 0) {
    throw new Error(`Expected success, got: ${result.stderr}`);
  }
});

// ---------------------------------------------------------------------------
// Placement behavior — document what the CLI currently does so gaps are visible
// ---------------------------------------------------------------------------

test("trap coordinates are preserved as-is in sim-config (floor-tile trap ends on expected cell)", () => {
  // A trap at (2,2) in a medium-or-larger room where (2,2) is a floor tile.
  // Verifies the coordinate round-trip: parsed x/y appear unchanged in sim-config.
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-trap-placement-roundtrip-"));
  const result = runCli([
    "create",
    "--room", "size=medium;count=1",
    "--trap", "x=2;y=2;affinity=fire;expression=emit;stacks=2",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--out-dir", outDir,
  ]);
  if (result.status !== 0) {
    throw new Error(`Expected success, got: ${result.stderr}`);
  }
  const simConfig = readJson(join(outDir, "sim-config.json"));
  const traps = simConfig.layout?.data?.traps ?? [];
  const fireTrap = traps.find((t) => t.affinity?.kind === "fire");
  assert.ok(fireTrap, "fire trap should be present in sim-config");
  assert.equal(fireTrap.x, 2, "trap x should match the requested coordinate");
  assert.equal(fireTrap.y, 2, "trap y should match the requested coordinate");
});

test("two traps at the same coordinate are rejected with a duplicate position error", () => {
  const result = runCli([
    "create",
    "--room", "size=medium;count=1",
    "--trap", "id=trap_a;x=2;y=2;affinity=fire;expression=emit;stacks=1",
    "--trap", "id=trap_b;x=2;y=2;affinity=water;expression=emit;stacks=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--dry-run",
  ]);
  assert.equal(result.status, 0);
  const dryRun = JSON.parse((result.stdout || "").trim());
  assert.equal(dryRun.valid, false, "dry-run should report invalid for duplicate trap positions");
  assert.ok(
    dryRun.errors.some((e) => /duplicate_trap|duplicate.*trap|trap.*duplicate/i.test(e)),
    `expected duplicate trap error in dry-run errors: ${JSON.stringify(dryRun.errors)}`,
  );
});

test("trap placed at grid-origin (x=0,y=0) is rejected because (0,0) is always a wall tile", () => {
  const result = runCli([
    "create",
    "--room", "size=medium;count=1",
    "--trap", "x=0;y=0;affinity=fire;expression=emit;stacks=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--out-dir", mkdtempSync(join(os.tmpdir(), "ak-trap-placement-wall-")),
  ]);
  assert.notEqual(result.status, 0, "trap on wall tile (0,0) must be rejected");
  const output = JSON.parse((result.stdout || result.stderr || "").trim().split("\n").pop());
  assert.ok(
    /trap_on_wall|out_of_bounds/i.test(JSON.stringify(output)),
    `expected trap_on_wall or out_of_bounds error: ${JSON.stringify(output)}`,
  );
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations
// Known-valid behaviors confirmed during this authoring pass:
//   - Duplicate trap coordinates → rejected via dry-run valid:false (traps[N].position:duplicate_trap)
//   - Small room with traps → rejected via dry-run valid:false
//   - Trap on wall tile (x=0,y=0) → currently accepted silently (see wall-tile test above)
//
// Stubs below need implementation before expansion:
// ---------------------------------------------------------------------------

// TODO: trap x beyond grid width is rejected — e.g. x=999 silently expands the grid rather than erroring; CLI should reject
// TODO: trap y beyond grid height is rejected — same gap as above for y axis
// TODO: trap on wall tile is rejected — confirmed fixed; non-walkable position returns trap_on_wall error
// TODO: trap on exit tile (coordinates matching sim-config layout.data.exit) is rejected
// TODO: trap on spawn tile (coordinates matching sim-config layout.data.spawn) is rejected
// TODO: trap count exceeding available floor tiles is rejected — e.g. 30 traps where room has 23 walkable cells
// TODO: trap x or y supplied as a string token (x=north) is rejected at parse time
// TODO: trap vitals=mana:0:0 (zero max, zero regen) — verify zero-max is accepted or rejected intentionally
// TODO: trap with only durability vital (no mana) is accepted — confirm each vital is independently optional
// TODO: multiple traps with distinct coordinates appear in sim-config in declared order
// TODO: trap coordinates adjacent to exit tile are accepted (ensure adjacency != exit tile check)
// TODO: trap coordinates adjacent to spawn tile are accepted
// TODO: trap with blocking=true is placed and actors cannot traverse the occupied tile
