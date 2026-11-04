// #715: `recipe=<name>` on a delver or warden spec expands to the recipe's fields through the
// Configurator, as if typed; any field the spec writes itself wins, and a warden's trimmed slots
// are reported. Design: project notes recipes-2026-11-04.md section 8.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const ROOT = resolve(__dirname, "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

async function specs() {
  const { createAuthoringSpecs } = await import("../../packages/runtime/src/commands/authoring-specs.js");
  return createAuthoringSpecs({ makeId: () => "t" });
}

const TYPED_SHADOWBLADE = "affinity=fire;affinities=fire:push:3:2,dark:emit:3:1,light:emit:1:1;equip=fire:push,dark:emit,light:emit;"
  + "vitals=health:20:1,mana:30:6,stamina:30:3,durability:10:1";

test("a recipe expands to exactly the spec a person would type", async () => {
  const { parseDelverSpecs } = await specs();
  const [byName] = parseDelverSpecs(["recipe=shadowblade;motivation=user_controlled"]);
  const [typed] = parseDelverSpecs([`${TYPED_SHADOWBLADE};motivation=user_controlled`]);
  assert.deepEqual(byName.value, typed.value);
});

test("fields the spec writes override the recipe: vitals one by one, affinities with their equip", async () => {
  const { parseDelverSpecs } = await specs();
  const [mana] = parseDelverSpecs(["recipe=shadowblade;vitals=mana:60:6"]);
  assert.deepEqual(mana.value.vitals.mana, { current: 60, max: 60, regen: 6 });
  assert.deepEqual(mana.value.vitals.health, { current: 20, max: 20, regen: 1 }, "the recipe's other vitals stay");
  const [own] = parseDelverSpecs(["recipe=shadowblade;affinities=decay:push:2:1"]);
  assert.deepEqual(own.value.affinities.map((entry) => `${entry.kind}:${entry.expression}`), ["decay:push"]);
  assert.equal(own.value.affinity, "decay", "the primary kind follows the spec's own affinities");
  assert.equal(own.value.activeAffinityKey, undefined, "the recipe's equip order is dropped with its affinities");
});

test("a warden keeps the recipe's first two slots and the parse reports what it left out", async () => {
  const { parseWardenSpecs } = await specs();
  const [warden] = parseWardenSpecs(["recipe=lantern-bearer;count=2"]);
  assert.deepEqual(warden.affinities.map((entry) => `${entry.kind}:${entry.expression}:${entry.stacks}:${entry.intensity}`),
    ["light:emit:3:2", "light:pull:2:1"]);
  assert.deepEqual(warden.equippedAffinityKeys, ["light:emit", "light:pull"]);
  assert.equal(warden.count, 2);
});

test("kind= sets a {K} recipe's kind and needs recipe=; an unknown recipe names the known ones", async () => {
  const { parseWardenSpecs, parseDelverSpecs } = await specs();
  const [ward] = parseWardenSpecs(["recipe=spellward;kind=water"]);
  assert.deepEqual(ward.affinities.map((entry) => entry.kind), ["water", "water"]);
  assert.throws(() => parseDelverSpecs(["kind=water;affinity=fire"]), /delver\[1\] kind= sets a recipe's \{K\} kind; give recipe= too\./);
  assert.throws(() => parseDelverSpecs(["recipe=necromancer"]), /delver\[1\]: unknown recipe "necromancer" \(known: shadowblade,/);
});

test("ak create builds the design's example level and reports the warden's trimmed slot", () => {
  const outDir = mkdtempSync(join(tmpdir(), "ak-recipe-"));
  try {
    const result = spawnSync(process.execPath, [AK, "create", "--grade", "F", "--room", "size=medium;count=3",
      "--delver", "recipe=shadowblade;motivation=user_controlled", "--warden", "recipe=lantern-bearer",
      "--out-dir", outDir, "--run-id", "t", "--created-at", "2026-11-04T00:00:00Z"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.ok, true);
    assert.deepEqual(summary.warnings, ["warden[1] recipe lantern-bearer keeps light:emit, light:pull; a warden has 2 slots, so light:push is left out."]);
    const actors = JSON.parse(readFileSync(join(outDir, "initial-state.json"), "utf8")).actors;
    const hero = actors.find((actor) => actor.motivations?.includes("user_controlled"));
    assert.deepEqual(hero.equippedAffinityKeys, ["fire:push", "dark:emit", "light:emit"]);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
