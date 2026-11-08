// #722: an explicit `equip=` that leaves a held attack in the pack while a slot is free is
// reported as a warning (never refused): the actor cannot strike with it until it equips it.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/agon.mjs");

async function warnings(args) {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  return createConfiguratorPersona({ clock: () => "2026-11-04T00:00:00.000Z" }).equipOmissionWarnings(args);
}

const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const HARMFUL = ["fire", "water", "earth", "wind", "decay", "corrode", "dark"];

test("every harmful kind's push left out of a part-filled equip order is warned about", async () => {
  for (const kind of KINDS) {
    const result = await warnings({ role: "delver", index: 1, affinities: [
      { kind, expression: "emit", stacks: 2 }, { kind, expression: "push", stacks: 3 },
    ], equip: [{ kind, expression: "emit" }] });
    if (HARMFUL.includes(kind)) {
      assert.equal(result.length, 1, `${kind}: one warning`);
      assert.match(result[0], new RegExp(`delver\\[1\\] holds ${kind}:push \\(attack\\).*2 slots free`));
    } else {
      assert.deepEqual(result, [], `${kind}: a restoring push is support, not an attack`);
    }
  }
});

test("no warning when every attack is equipped, when no equip order is given, or when the slots are full", async () => {
  const held = [{ kind: "fire", expression: "push", stacks: 2 }, { kind: "dark", expression: "emit", stacks: 1 },
    { kind: "light", expression: "emit", stacks: 1 }, { kind: "decay", expression: "pull", stacks: 1 }];
  assert.deepEqual(await warnings({ role: "delver", index: 1, affinities: held.slice(0, 2),
    equip: [{ kind: "fire", expression: "push" }, { kind: "dark", expression: "emit" }] }), []);
  assert.deepEqual(await warnings({ role: "delver", index: 1, affinities: held }), [], "no equip= is not an omission");
  assert.deepEqual(await warnings({ role: "delver", index: 1, affinities: held,
    equip: [{ kind: "fire", expression: "push" }, { kind: "dark", expression: "emit" }, { kind: "light", expression: "emit" }] }),
  [], "with every slot full the pack is the author's choice");
  assert.equal((await warnings({ role: "warden", index: 2, slots: 2, affinities: held.slice(0, 2),
    equip: [{ kind: "dark", expression: "emit" }] }))[0].startsWith("warden[2] holds fire:push"), true);
});

test("agon create prints the warning and carries it in its JSON result, and still builds the level", () => {
  const outDir = mkdtempSync(join(tmpdir(), "agon-equip-omission-"));
  try {
    const run = (delver) => {
      const result = spawnSync(process.execPath, [AK, "create", "--budget-tokens", "4000",
        "--room", "size=medium;count=1", "--delver", delver, "--out-dir", outDir, "--run-id", "t", "--created-at", "2026-11-04T00:00:00Z"], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return { stderr: result.stderr, json: JSON.parse(result.stdout) };
    };
    const base = "count=1;id=hero;affinity=fire;affinities=fire:emit:2:1,fire:push:3:1;motivation=user_controlled;vitals=health:20:1,mana:30:3,stamina:10:2,durability:10:1";
    const omitted = run(`${base};equip=fire:emit`);
    assert.match(omitted.stderr, /warning: delver\[1\] holds fire:push \(attack\) but equip= leaves it in the pack/);
    assert.equal(omitted.json.ok, true);
    assert.equal(omitted.json.warnings.length, 1);
    const listed = run(`${base};equip=fire:emit,fire:push`);
    assert.doesNotMatch(listed.stderr, /warning: delver/);
    assert.equal(listed.json.warnings, undefined);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
