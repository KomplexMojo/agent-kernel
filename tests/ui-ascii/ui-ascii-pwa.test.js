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
    for (const file of ["index.html", "app.js", "catalog.json", "sw.js", "manifest.webmanifest", "icon-192.png", ".nojekyll", "levels/first-look-s0.json"]) {
      assert.ok(existsSync(join(out, file)), `${file} is built`);
    }
    // The runtime play session still has debugView(); only the console that shows it (web.mjs) must stay out.
    assert.doesNotMatch(readFileSync(join(out, "app.js"), "utf8"), /ANALYSIS \(debug\)|refreshDebug/, "no analysis console in the bundle");
    const sw = readFileSync(join(out, "sw.js"), "utf8");
    assert.doesNotMatch(sw, /__CACHE__|__PRECACHE__/);
    assert.match(sw, /levels\/first-look-s0\.json/);
    const level = JSON.parse(readFileSync(join(out, "levels/first-look-s0.json"), "utf8"));
    const game = await createGame({ levels: [{ name: "pwa", ...level }], fog: true, showHelp: false });
    await game.handle({ type: "wait" });
    assert.equal(game.state().turns, 1);
    assert.ok(readdirSync(join(out, "levels")).length === 1);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
