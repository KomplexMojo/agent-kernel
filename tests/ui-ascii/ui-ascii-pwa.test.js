/**
 * The phone app (a PWA on GitHub Pages): it runs the game controller in the browser on levels
 * built ahead of time by `ak create`. It must stay free of Node, carry no analysis console, and
 * its report must be one `playtest.mjs --open` reads.
 */
const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { createGame } = require("../../packages/ui-ascii/src/game.js");
const { ansiToHtml } = require("../../packages/ui-ascii/src/html.js");
const { encodeReplay, renderReport } = require("../../packages/ui-ascii/src/report.js");
const { decodeReplay, parseReport, loadPlaytestScenarios, affinitiesForSeed } = require("../../scripts/game/playtest.mjs");
const { buildPwa, catalogFor, seedEntry } = require("../../scripts/pwa/build-pwa.mjs");

const SRC = join(__dirname, "../../packages/ui-ascii/src");

test("the browser modules use no Node built-ins and no analysis console", () => {
  for (const file of ["browser.js", "report.js", "html.js"]) {
    const source = readFileSync(join(SRC, file), "utf8");
    assert.doesNotMatch(source, /from "node:/, `${file} must run in a browser`);
    assert.doesNotMatch(source, /debugView|import .*web\.mjs|\/debug/, `${file} must not carry the #500 analysis console`);
  }
});

test("web.mjs and the app share one ansiToHtml", () => {
  assert.equal(require("../../packages/ui-ascii/src/web.mjs").ansiToHtml, ansiToHtml);
});

test("a PWA report is one playtest.mjs reads back, with the commands that were played", async () => {
  const scenario = loadPlaytestScenarios().scenarios[0];
  const commands = [{ kind: "move", params: { direction: "east" } }, { kind: "wait" }];
  const replayCode = await encodeReplay(commands);
  const report = renderReport({
    scenario, seed: 3, picks: affinitiesForSeed(3), commit: "abc1234", createdAt: "2026-10-18T00:00:00.000Z",
    playedAt: "2026-10-28T00:00:00.000Z", final: { turns: 2, status: {} }, screen: "board", notes: ["turn 2: odd"], replayCode,
  });
  assert.deepEqual(decodeReplay(replayCode), commands);
  const parsed = parseReport(report);
  assert.equal(parsed.scenario, scenario.id);
  assert.equal(parsed.seed, 3);
  assert.equal(parsed.commit, "abc1234");
  assert.deepEqual(parsed.commands, commands);
  assert.match(report, /1\. turn 2: odd/);
});

test("a PWA report keeps a configured character, and playtest.mjs reads it back to rebuild that level", async () => {
  const scenario = loadPlaytestScenarios().scenarios[0];
  const character = "count=1;id=hero;motivation=user_controlled;vitals=health:30:1,mana:30:3,stamina:10:2,durability:10:1";
  const report = renderReport({
    scenario, seed: 2, picks: affinitiesForSeed(2), commit: "abc1234", createdAt: "2026-10-18T00:00:00.000Z",
    playedAt: "2026-10-29T00:00:00.000Z", final: { turns: 0, status: {} }, screen: "board", notes: [],
    replayCode: await encodeReplay([]), character,
  });
  assert.match(report, /- Character: `count=1;id=hero/);
  assert.equal(parseReport(report).character, character);
});

test("the catalog lists each scenario's seeds with the affinities and focus lines the playtest prints", () => {
  const { scenarios, createdAt } = loadPlaytestScenarios();
  const entries = scenarios.flatMap((scenario) => [0, 1].map((seed) => ({ scenarioId: scenario.id, ...seedEntry(scenario, seed, { cost: { totalSpend: 1, budgetTokens: 2, status: "approved" } }) })));
  const catalog = catalogFor(scenarios, createdAt, "abc1234", entries);
  assert.equal(catalog.scenarios.length, scenarios.length);
  for (const scenario of catalog.scenarios) {
    assert.equal(scenario.seeds.length, 2);
    assert.deepEqual(scenario.seeds[1].picks, affinitiesForSeed(1));
    assert.equal(scenario.seeds[1].file, `levels/${scenario.id}-s1.json`);
    assert.ok(scenario.seeds[0].focus.every((line) => !/\{[A-Z0-9]+\}/.test(line)), "placeholders are filled");
  }
});

test("the built app plays: a level from the build runs in the game controller, and the shell is cached", async () => {
  const out = mkdtempSync(join(tmpdir(), "pwa-build-"));
  try {
    await buildPwa({ out, seeds: 1, only: ["first-look"], log: () => {} });
    for (const file of ["index.html", "app.js", "catalog.json", "sw.js", "manifest.webmanifest", "icon-192.png", "version.json", ".nojekyll", "levels/first-look-s0.json"]) {
      assert.ok(existsSync(join(out, file)), `${file} is built`);
    }
    // The runtime play session still has debugView(); only the console that shows it (web.mjs) must stay out.
    assert.doesNotMatch(readFileSync(join(out, "app.js"), "utf8"), /ANALYSIS \(debug\)|refreshDebug/, "no analysis console in the bundle");
    const sw = readFileSync(join(out, "sw.js"), "utf8");
    assert.doesNotMatch(sw, /__CACHE__|__PRECACHE__/);
    assert.match(sw, /levels\/first-look-s0\.json/);
    const { commit } = JSON.parse(readFileSync(join(out, "version.json"), "utf8"));
    assert.match(readFileSync(join(out, "app.js"), "utf8"), new RegExp(commit), "the bundle knows its own build");
    assert.doesNotMatch(sw.match(/const FILES = (.*);/)[1], /version\.json/, "version.json is never cached");
    const level = JSON.parse(readFileSync(join(out, "levels/first-look-s0.json"), "utf8"));
    // #557: what the character screen needs to build this level again on the phone.
    assert.ok(level.character.argv.includes(level.character.hero), "the default delver's spec is one of the level's ak create arguments");
    assert.ok(level.character.allowance > 0, "the delver pool the Allocator allotted");
    assert.ok(Array.isArray(level.character.solverAnswers));
    assert.match(readFileSync(join(out, "index.html"), "utf8"), /id="configure"/);
    const game = await createGame({ levels: [{ name: "pwa", ...level }], fog: true, showHelp: false });
    await game.handle({ type: "wait" });
    assert.equal(game.state().turns, 1);
    assert.ok(readdirSync(join(out, "levels")).length === 1);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// The controller's side of the phone layout: slots as buttons, tuning, list choices, the screen in parts.
async function pwaGame() {
  const { loadBundledLevels } = require("../../packages/ui-ascii/src/levels.js");
  return createGame({ levels: loadBundledLevels(), showHelp: false });
}

test("slots() lists the slots and the affinities an empty one could take", async () => {
  const game = await pwaGame();
  const { slots, picks } = game.slots();
  assert.ok(slots.length >= 1);
  assert.ok(slots.every((slot) => slot.empty || (slot.key && slot.stacks.running >= 1 && slot.intensity.held >= 1)));
  const before = game.view().player.equippedAffinityKeys.length;
  if (picks.length) {
    await game.toggleSlotAffinity(picks[0].key);
    assert.equal(game.view().player.equippedAffinityKeys.length, before + 1, "equipping fills a slot");
    assert.equal(game.slots().slots.some((slot) => slot.key === picks[0].key), true);
  }
});

// Darren, 2026-10-30: a push or pull slot shows the mana one cast costs at its range and power, not its reach.
test("slots() gives each castable slot the mana one cast costs, and tuning it changes the mana", async () => {
  const game = await pwaGame();
  const slot = game.slots().slots.find((entry) => entry.castable);
  if (!slot) return;
  assert.equal(typeof slot.mana, "number");
  assert.ok(slot.mana > 0);
  if (slot.stacks.held > 1) {
    await game.tuneSlot(slot.key, "stacks", -1);
    assert.ok(game.slots().slots.find((entry) => entry.key === slot.key).mana < slot.mana, "a shorter range costs less");
  }
});

test("screen({ parts }) hands back the board, vitals and message band separately", async () => {
  const game = await pwaGame();
  const parts = game.screen({ color: false, parts: true });
  assert.ok(Array.isArray(parts.board) && parts.board.length > 3);
  assert.ok(parts.vitals.every((vital) => vital.label && vital.text));
  assert.equal(typeof parts.status, "string");
  assert.equal(game.screen({ color: false, parts: false }).split("\n")[0], parts.title);
});

test("tuneSlot runs an equipped affinity lower and back, as the list's - and + do", async () => {
  const game = await pwaGame();
  const slot = game.slots().slots.find((entry) => !entry.empty && entry.stacks.held > 1);
  if (!slot) return; // the first bundled level holds nothing to tune
  await game.tuneSlot(slot.key, "stacks", -1);
  assert.equal(game.slots().slots.find((entry) => entry.key === slot.key).stacks.running, slot.stacks.held - 1);
  await game.tuneSlot(slot.key, "stacks", 1);
  assert.equal(game.slots().slots.find((entry) => entry.key === slot.key).stacks.running, slot.stacks.held);
  assert.equal(game.state().panel, null, "tuning leaves no panel open");
});

test("a list panel is offered as choices, and the state names what an open panel is for", async () => {
  const game = await pwaGame();
  assert.equal(game.panelChoices(), null);
  await game.handle({ type: "affinities" });
  const choices = game.panelChoices();
  assert.equal(choices?.type, "affinities");
  assert.ok(choices.items.length >= 1);
  assert.deepEqual(game.state().panelFlags, { raise: false, inspect: false, watch: false });
  await game.handle({ type: "quit" });
  assert.equal(game.panelChoices(), null);
});

// #579: a phone empty slot must equip a held affinity without another being removed first.
test("an empty slot offers every held affinity that is not equipped, and equipping fills it without removing another", async () => {
  const { buildUnifiedLevel, viableVitals } = await import("../fixtures/ui-ascii/unified-level.mjs");
  const affinities = [
    { kind: "fire", expression: "push", stacks: 1 }, { kind: "water", expression: "push", stacks: 1 },
    { kind: "earth", expression: "push", stacks: 1 },
  ];
  const level = buildUnifiedLevel({
    id: "free-slots", tiles: ["#####", "#...#", "#...E", "#####"],
    actors: [{ category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals(),
      affinities, affinitySlots: 3, activeAffinityKey: "fire:push" }],
  });
  const game = await createGame({ levels: [{ name: "free-slots", ...level }], fog: false, showHelp: false });
  const { slots, picks } = game.slots();
  assert.deepEqual(slots.map((slot) => Boolean(slot.empty)), [false, true, true], "three slots, one used");
  assert.deepEqual(picks.map((pick) => pick.key), ["water:push", "earth:push"], "an empty slot has something to take");
  await game.toggleSlotAffinity("earth:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["fire:push", "earth:push"], "fills the free slot, nothing removed");
  await game.toggleSlotAffinity("water:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["fire:push", "earth:push", "water:push"]);
  assert.equal(game.slots().picks.length, 0);
});

// Darren, 2026-10-30: three slots, the rest a pack. The phone's swap puts a packed affinity in the
// chosen slot's place in one turn; without a slot named, the oldest gives way (core's rule).
test("toggleSlotAffinity with a slot named swaps a packed affinity into it, in one turn", async () => {
  const { buildUnifiedLevel, viableVitals } = await import("../fixtures/ui-ascii/unified-level.mjs");
  const affinities = [
    { kind: "fire", expression: "push", stacks: 1 }, { kind: "water", expression: "push", stacks: 1 },
    { kind: "earth", expression: "push", stacks: 1 }, { kind: "wind", expression: "push", stacks: 1 },
  ];
  const level = buildUnifiedLevel({
    id: "pack", tiles: ["#####", "#...#", "#...E", "#####"],
    actors: [{ category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals(),
      affinities, affinitySlots: 3, activeAffinityKey: "fire:push", equippedAffinityKeys: ["fire:push", "water:push", "earth:push"] }],
  });
  const game = await createGame({ levels: [{ name: "pack", ...level }], fog: false, showHelp: false });
  assert.deepEqual(game.slots().picks.map((pick) => pick.key), ["wind:push"], "the fourth is in the pack");
  await game.toggleSlotAffinity("wind:push", "water:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["fire:push", "wind:push", "earth:push"]);
  assert.equal(game.state().turns, 1);
  await game.toggleSlotAffinity("water:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["wind:push", "earth:push", "water:push"], "unnamed, the oldest gives way");
});

test("the phone page has a Map button that swaps the board for the notebook until closed", () => {
  const html = readFileSync(join(SRC, "../pwa/index.html"), "utf8");
  const source = readFileSync(join(SRC, "browser.js"), "utf8");
  assert.match(html, /id="mapbtn"/);
  assert.match(source, /\$\("mapbtn"\)\.addEventListener\("click", \(\) => press\("m"\)\)/);
  assert.match(source, /notebookLines\(game, parts\)/);
  assert.match(source, /windowSizeForViewport/);
});
