/**
 * The character screen: draws the runtime character sheet, maps keys to its intents, and the
 * spec it writes builds a level through `ak create` with exactly that delver. The screen
 * prices nothing; the Allocator does (tests/runtime/character-sheet.test.js).
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ROOT = join(__dirname, "../..");
const SCREEN = "../../packages/ui-ascii/src/character-screen.js";
const SHEET = "../../packages/runtime/src/runner/character-sheet.js";
const CLI = join(ROOT, "packages/ui-ascii/src/character-cli.mjs");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const HERO = "count=1;id=hero;affinity=fire;affinities=fire:emit:2:1,fire:push:3:1;equip=fire:emit;motivation=user_controlled;vitals=health:20:1,mana:30:3,stamina:10:2,durability:10:1";

test("the screen shows every row with its price, the budget, and the keys", async () => {
  const { renderCharacterScreen } = await import(SCREEN);
  const { createCharacterSheet } = await import(SHEET);
  const text = renderCharacterScreen(createCharacterSheet({ spec: HERO, budgetTokens: 942 }).view());
  assert.match(text, /YOUR DELVER\s+Spent 234 \/ 942/);
  assert.match(text, /Affinities: 3 equipped, then the pack/);
  assert.match(text, /> 1\s+\[fire\]/, "the cursor opens on the first slot's kind");
  assert.match(text, /    3   none      push    1     1                      0/, "an empty slot is kind none at the default form and range, and spends no mana");
  assert.match(text, /\[fire\]     emit    2     1     5\/tick          53/, "an emit's mana is per tick");
  assert.match(text, /fire      push    3     1     12\/cast         73/, "a push's mana is per cast");
  assert.match(text, /emits and draws together: 5 mana a tick, against mana regen 3/);
  assert.match(text, /mana\s+30\s+3\s+39/);
  assert.match(text, /Ready: 708 tokens left/);
  assert.match(text, /Enter play/);
  assert.doesNotMatch(text, /\u001b\[/, "no colour when none is asked for");
});

test("over budget the screen says so and the colour comes from the approved palette", async () => {
  const { renderCharacterScreen } = await import(SCREEN);
  const { createCharacterSheet } = await import(SHEET);
  const view = createCharacterSheet({ spec: HERO, budgetTokens: 100 }).view();
  assert.match(renderCharacterScreen(view), /! 134 tokens over the allowance\./);
  assert.match(renderCharacterScreen(view, { color: "truecolor" }), /\u001b\[38;2;198;90;74m/);
});

test("keys map to sheet intents, the same names every surface sends", async () => {
  const { sheetIntentForKey } = await import(SCREEN);
  const { SHEET_INTENT } = await import(SHEET);
  assert.equal(sheetIntentForKey("\u001b[A"), SHEET_INTENT.UP);
  assert.equal(sheetIntentForKey("j"), SHEET_INTENT.DOWN);
  assert.equal(sheetIntentForKey("+"), SHEET_INTENT.INC);
  assert.equal(sheetIntentForKey("]"), SHEET_INTENT.INC_BIG);
  assert.equal(sheetIntentForKey("\r"), SHEET_INTENT.CONFIRM);
  assert.equal(sheetIntentForKey("\u001b"), SHEET_INTENT.CANCEL);
  assert.equal(sheetIntentForKey("%"), null);
});

test("the scripted CLI applies keys and the confirmed spec builds that delver through ak create", () => {
  const dir = mkdtempSync(join(tmpdir(), "character-screen-"));
  try {
    const specFile = join(dir, "spec.txt");
    // Right twice to slot 1's range and one up; down seven rows (three more slots, health) to mana, left to its max, five more.
    const run = spawnSync(process.execPath, [CLI, "--spec", HERO, "--budget", "942", "--keys", "dd+sssssssh]\r", "--out", specFile, "--no-color"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const spec = readFileSync(specFile, "utf8").trim();
    assert.match(spec, /affinities=fire:emit:3,fire:push:3/);
    assert.match(spec, /vitals=health:20:1,mana:35:3/);
    const level = join(dir, "level");
    const create = spawnSync(process.execPath, [AK, "create", "--budget-tokens", "4000", "--room", "size=medium;count=2", "--delver", spec, "--out-dir", level], { encoding: "utf8" });
    assert.equal(create.status, 0, create.stderr || create.stdout);
    const state = JSON.parse(readFileSync(join(level, "initial-state.json"), "utf8"));
    const hero = JSON.stringify(state).match(/"mana":\{[^}]*\}/g);
    assert.ok(hero.some((chunk) => /"max":35/.test(chunk)), "the built hero has the configured mana");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("going back writes no spec and exits 3", () => {
  const run = spawnSync(process.execPath, [CLI, "--spec", HERO, "--keys", "q", "--out", join(tmpdir(), "never-written.txt")], { encoding: "utf8" });
  assert.equal(run.status, 3);
  assert.equal(existsSync(join(tmpdir(), "never-written.txt")), false);
});

test("playtest.sh --character swaps the scenario's playable delver for the configured one", async () => {
  const { loadPlaytestScenarios, scenarioArgs, playerDelverSpec } = await import("../../scripts/game/playtest.mjs");
  const scenario = loadPlaytestScenarios().scenarios[0];
  const args = scenarioArgs(scenario, 3, undefined, "count=1;id=hero;motivation=user_controlled;vitals=health:11:1");
  assert.ok(args.includes("count=1;id=hero;motivation=user_controlled;vitals=health:11:1"));
  assert.ok(!args.includes(playerDelverSpec(scenario, 3)));
  assert.deepEqual(scenarioArgs(scenario, 3), scenarioArgs(scenario, 3, undefined, undefined), "no character, no change");
});
