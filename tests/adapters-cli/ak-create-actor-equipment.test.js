// ak create `slots=` / `equip=` on delver and warden specs, end to end: the actors start
// with those slots and equips, extra slots are on the receipt, and bad specs are refused.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function create(args) {
  const dir = mkdtempSync(join(tmpdir(), "ak-create-equip-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=small;count=1", ...args,
    "--created-at", "2026-10-14T00:00:00.000Z", "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { result, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Darren, 2026-10-30: three equipped slots at most, the rest carried as a pack; no slot is bought.
test("delvers and wardens start with their preset slots and the authored equips; a fourth affinity is carried", () => {
  const run = create([
    "--delver", "count=1;affinity=earth;motivation=exploring;affinities=earth:push:3,light:emit:1,dark:emit:1,fire:pull:1;equip=earth:push:2,light:emit,dark:emit",
    "--warden", "count=1;affinity=corrode;motivation=random;equip=corrode:push",
    "--budget-tokens", "20000",
  ]);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const actors = Object.fromEntries(run.read("initial-state.json").actors.map((actor) => [actor.id, actor]));
    const delver = actors["card_delver_1-1"];
    assert.equal(delver.affinitySlots ?? 3, 3);
    assert.ok(delver.affinities.some((entry) => entry.kind === "fire" && entry.expression === "pull"), "the fourth is held, in the pack");
    assert.equal(delver.activeAffinityKey, "earth:push");
    assert.deepEqual(delver.equippedAffinityKeys, ["earth:push", "light:emit", "dark:emit"]);
    assert.deepEqual(delver.equippedAffinityStacks, { "earth:push": 2 });
    const warden = actors["card_warden_1-1"];
    assert.equal(warden.affinitySlots, 2, "the warden keeps its preset slots");
    assert.equal(warden.activeAffinityKey, "corrode:push");

    const slotLines = run.read("budget-receipt.json").lineItems.filter((line) => line.id === "resource_affinity_slot");
    assert.deepEqual(slotLines, [], "no slot is bought");
  } finally {
    run.cleanup();
  }
});

test("a spec core could not load is refused with what is wrong", () => {
  const cases = [
    ["count=1;affinity=growth;equip=growth:emit", /delver\[1\] cannot equip growth:emit: it holds only growth:push/],
    ["count=1;affinity=growth;slots=4", /delver\[1\] slots must be an integer from 1 to 3, got 4: extra slots are retired/],
    ["count=1;affinity=growth;equip=growth", /delver\[1\] equip\[1\] must be kind:expression\[:stacks\]/],
  ];
  for (const [spec, message] of cases) {
    const run = create(["--delver", spec]);
    try {
      assert.notEqual(run.result.status, 0, spec);
      assert.match(run.result.stdout + run.result.stderr, message);
    } finally {
      run.cleanup();
    }
  }
});

test("an MCP structured spec carries slots and equip to the same CLI spec", async () => {
  const { specObjectToString } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  assert.equal(specObjectToString({
    count: 1, affinity: "earth", slots: 4,
    affinities: [{ kind: "earth", expression: "push", stacks: 3 }, { kind: "light", expression: "emit" }],
    equip: [{ kind: "earth", expression: "push", stacks: 2 }, "light:emit"],
  }), "count=1;affinity=earth;slots=4;affinities=earth:push:3,light:emit:1;equip=earth:push:2,light:emit");
});

// ## TODO: Test Permutations
// - warden slots=3 is charged one slot
// - equip with count=2 gives both instances the same equips
// - delver-plan and warden-plan accept the same keys
