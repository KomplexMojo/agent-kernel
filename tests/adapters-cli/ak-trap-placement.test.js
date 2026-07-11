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
// Size behavior — small generates medium-identical geometry, so traps are accepted
// ---------------------------------------------------------------------------

test("trap on a small room succeeds and maps into the room interior exactly like medium", () => {
  // Updated 2026-07-10: the size=small trap precheck was removed (M3, alongside the room-relative
  // coordinate adjudication) — size=small generates the identical grid/room geometry size=medium
  // does when traps are present (roomMinSize is bumped to fit them), so the old blanket rejection
  // contradicted the generated geometry. Formerly this test pinned that rejection.
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-trap-placement-small-"));
  const result = runCli([
    "create",
    "--room", "size=small;count=1",
    "--trap", "x=2;y=2;affinity=fire",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--out-dir", outDir,
  ]);
  assert.equal(result.status, 0, `small room + trap must succeed like medium: ${result.stderr}`);
  const layout = readJson(join(outDir, "sim-config.json")).layout?.data ?? {};
  const fireTrap = (layout.traps ?? []).find((t) => t.affinity?.kind === "fire");
  const room = (layout.rooms ?? [])[0];
  assert.ok(fireTrap, "fire trap should be present in sim-config");
  assert.ok(room, "layout should declare a room");
  assert.equal(fireTrap.x, room.x + 2, "trap x should be room.x + authored relative x");
  assert.equal(fireTrap.y, room.y + 2, "trap y should be room.y + authored relative y");
  assert.notEqual(layout.tiles?.[fireTrap.y]?.[fireTrap.x], "#", "mapped trap tile must be floor, not wall");
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

test("authored room-relative trap coordinates are mapped to absolute room-interior coordinates in sim-config", () => {
  // Updated 2026-07-10: trap coordinates adjudicated as room-relative (M3); formerly pinned grid-absolute semantics.
  // A trap authored at (2,2) is an offset into the target room's interior (traps map into the
  // first declared room): stored absolute x/y must equal room.x + 2, room.y + 2 and land on floor.
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
  const layout = simConfig.layout?.data ?? {};
  const traps = layout.traps ?? [];
  const rooms = layout.rooms ?? [];
  const fireTrap = traps.find((t) => t.affinity?.kind === "fire");
  assert.ok(fireTrap, "fire trap should be present in sim-config");
  assert.ok(rooms.length >= 1, "layout should declare at least one room");
  const room = rooms[0];
  assert.equal(fireTrap.x, room.x + 2, "trap x should be room.x + authored relative x");
  assert.equal(fireTrap.y, room.y + 2, "trap y should be room.y + authored relative y");
  assert.notEqual(layout.tiles?.[fireTrap.y]?.[fireTrap.x], "#", "mapped trap tile must be floor, not wall");
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

test("trap authored at room-relative (0,0) maps onto the room's top-left interior floor tile", () => {
  // Updated 2026-07-10: trap coordinates adjudicated as room-relative (M3); formerly pinned grid-absolute semantics.
  // (0,0) used to be the grid border and was rejected trap_on_wall; it is now a valid room-relative
  // offset mapping to (room.x, room.y), which is carved floor inside the room.
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-trap-placement-origin-"));
  const result = runCli([
    "create",
    "--room", "size=medium;count=1",
    "--trap", "x=0;y=0;affinity=fire;expression=emit;stacks=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--out-dir", outDir,
  ]);
  assert.equal(result.status, 0, `trap at room-relative (0,0) must be accepted: ${result.stderr}`);
  const layout = readJson(join(outDir, "sim-config.json")).layout?.data ?? {};
  const fireTrap = (layout.traps ?? []).find((t) => t.affinity?.kind === "fire");
  const room = (layout.rooms ?? [])[0];
  assert.ok(fireTrap, "fire trap should be present in sim-config");
  assert.ok(room, "layout should declare a room");
  assert.equal(fireTrap.x, room.x, "relative (0,0) maps to the room's top-left x");
  assert.equal(fireTrap.y, room.y, "relative (0,0) maps to the room's top-left y");
  assert.notEqual(layout.tiles?.[fireTrap.y]?.[fireTrap.x], "#", "mapped trap tile must be floor, not wall");
});

test("trap with room-relative coords exceeding the room interior is rejected with trap_outside_room", () => {
  // Updated 2026-07-10 (M3): replacement rejection case for the removed grid-border rejection above.
  // A medium room's interior is 5x5, so relative (8,8) exceeds it (while staying inside the 9x9 grid,
  // which keeps this a room-bounds rejection rather than a grid out_of_bounds one).
  const result = runCli([
    "create",
    "--room", "size=medium;count=1",
    "--trap", "x=8;y=8;affinity=fire;expression=emit;stacks=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--out-dir", mkdtempSync(join(os.tmpdir(), "ak-trap-placement-oob-")),
  ]);
  assert.notEqual(result.status, 0, "trap coords beyond the room interior must be rejected");
  const output = JSON.parse((result.stdout || result.stderr || "").trim().split("\n").pop());
  assert.ok(
    /trap_outside_room/i.test(JSON.stringify(output)),
    `expected trap_outside_room error: ${JSON.stringify(output)}`,
  );
});

test("trap x or y supplied as a string token is rejected at parse time", () => {
  const result = runCli([
    "create",
    "--trap", "x=north;y=2;affinity=fire",
    "--delver", "count=1;affinity=fire;motivation=attacking",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trap\[1\] x/i);
});

test("multiple traps with distinct coordinates appear in sim-config in declared order", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-trap-placement-order-"));
  const result = runCli([
    "create",
    "--room", "size=medium;count=1",
    "--trap", "id=trap_a;x=2;y=2;affinity=fire;expression=emit;stacks=1",
    "--trap", "id=trap_b;x=3;y=2;affinity=water;expression=emit;stacks=1",
    "--delver", "count=1;affinity=fire;motivation=attacking",
    "--budget-tokens", "1000",
    "--budget", BUDGET,
    "--price-list", PRICE_LIST,
    "--out-dir", outDir,
  ]);
  assert.equal(result.status, 0, result.stderr);

  const simConfig = readJson(join(outDir, "sim-config.json"));
  assert.deepEqual(
    (simConfig.layout?.data?.traps ?? []).map((trap) => trap.affinity?.kind),
    ["fire", "water"],
  );
});

test.skip("trap x beyond grid width is rejected instead of expanding the grid", () => {});
test.skip("trap y beyond grid height is rejected instead of expanding the grid", () => {});
test.skip("trap on exit tile is rejected", () => {});
test.skip("trap on spawn tile is rejected", () => {});
test.skip("trap count exceeding available floor tiles is rejected", () => {});
test.skip("trap vitals=mana:0:0 has an intentional accept/reject contract", () => {});
test.skip("trap with only durability vital and no mana is independently optional", () => {});
test.skip("trap coordinates adjacent to exit tile are accepted", () => {});
test.skip("trap coordinates adjacent to spawn tile are accepted", () => {});
test.skip("trap with blocking=true prevents actor traversal", () => {});
