/**
 * The game in a browser tab (`--web`): a local server runs the same game controller
 * and shows the same screen as HTML. Keys go in as the terminal's key strings.
 */
const assert = require("node:assert/strict");

const { createGame } = require("../../packages/ui-ascii/src/game.js");
const { loadBundledLevels } = require("../../packages/ui-ascii/src/levels.js");
const { ansiToHtml, lanAddresses, startWebGame } = require("../../packages/ui-ascii/src/web.mjs");

async function serve(options) {
  const game = await createGame({ levels: loadBundledLevels(), showHelp: false });
  const server = await startWebGame(game, { port: 0, ...options });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((done) => { server.closeAllConnections(); server.close(done); });
  return { game, base, stop };
}

test("ANSI colour becomes inline styles and text is escaped", () => {
  assert.equal(ansiToHtml("\u001b[48;2;1;2;3m\u001b[38;2;4;5;6m<@>\u001b[0m."),
    '<span style="color:rgb(4,5,6);background:rgb(1,2,3)">&lt;@&gt;</span>.');
});

test("the page loads, a key plays a turn, and q does not end the game", async () => {
  const { game, base, stop } = await serve();
  try {
    const page = await (await fetch(`${base}/`)).text();
    assert.match(page, /<pre id="screen">/);
    const before = game.state().turns;
    const html = await (await fetch(`${base}/key`, { method: "POST", body: "." })).text();
    assert.equal(game.state().turns, before + 1);
    assert.match(html, /<span style=/, "the screen arrives in colour");
    await fetch(`${base}/key`, { method: "POST", body: "q" });
    assert.match(await (await fetch(`${base}/screen`)).text(), /Tick/);
    assert.equal((await fetch(`${base}/nowhere`)).status, 404);
  } finally {
    await stop();
  }
});

test("arrow keys arrive as the terminal's escape sequences", async () => {
  const { game, base, stop } = await serve();
  try {
    const before = game.state().turns;
    await fetch(`${base}/key`, { method: "POST", body: "\u001b[C" });
    assert.equal(game.state().turns, before + 1);
  } finally {
    await stop();
  }
});

test("the page carries touch buttons that send the terminal's keys", async () => {
  const { base, stop } = await serve();
  try {
    const page = await (await fetch(`${base}/`)).text();
    for (const key of ["k", "j", "h", "l", ".", "i", "f", "o", encodeURIComponent("\t"), encodeURIComponent("\u001b")]) {
      assert.ok(page.includes(`data-key="${key}"`), `a button sends ${JSON.stringify(key)}`);
    }
  } finally {
    await stop();
  }
});

test("--lan prints the machine's external IPv4 addresses only", () => {
  assert.deepEqual(lanAddresses({
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    en0: [{ family: "IPv6", address: "fe80::1", internal: false }, { family: "IPv4", address: "192.168.1.20", internal: false }],
  }), ["192.168.1.20"]);
});

// #500: the analysis console is evaluation only, so it exists only with --debug.
test("the analysis console is absent without --debug and present with it", async () => {
  const plain = await serve();
  try {
    assert.doesNotMatch(await (await fetch(`${plain.base}/`)).text(), /id="debug"/);
    assert.equal((await fetch(`${plain.base}/debug`)).status, 404);
  } finally { await plain.stop(); }
  const debug = await serve({ debug: true });
  try {
    assert.match(await (await fetch(`${debug.base}/`)).text(), /id="debug"/);
    await fetch(`${debug.base}/key`, { method: "POST", body: "." });
    const data = await (await fetch(`${debug.base}/debug`)).json();
    assert.ok(data.actors.length > 0 && data.actors.every((actor) => actor.vitals && Array.isArray(actor.affinities)));
    assert.equal(data.tick, 1);
    assert.ok(Array.isArray(data.events) && Array.isArray(data.field));
  } finally { await debug.stop(); }
});

// #514: a level built with `ak create --out-dir` carries its receipt and price list into the console.
test("the analysis console carries the build's budget receipt and price list", async () => {
  const { copyFileSync, mkdtempSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const { BUNDLED_LEVELS_DIR, loadLevelFromRunDir } = require("../../packages/ui-ascii/src/levels.js");
  const dir = mkdtempSync(join(tmpdir(), "ak-costing-"));
  try {
    copyFileSync(join(BUNDLED_LEVELS_DIR, "first-steps.sim-config.json"), join(dir, "sim-config.json"));
    copyFileSync(join(BUNDLED_LEVELS_DIR, "first-steps.initial-state.json"), join(dir, "initial-state.json"));
    copyFileSync(join(__dirname, "../fixtures/artifacts/budget-receipt-artifact-v1-basic.json"), join(dir, "budget-receipt.json"));
    copyFileSync(join(__dirname, "../fixtures/artifacts/price-list-artifact-v1-basic.json"), join(dir, "price-list.json"));
    const level = loadLevelFromRunDir(dir);
    assert.equal(level.costing.receipt.status, "approved");
    const game = await createGame({ levels: [level], showHelp: false });
    const server = await startWebGame(game, { port: 0, debug: true });
    try {
      const data = await (await fetch(`http://127.0.0.1:${server.address().port}/debug`)).json();
      assert.equal(data.costing.receipt.totalCost, 0);
      assert.equal(data.costing.prices.items.length, 2);
    } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    assert.equal(loadBundledLevels()[0].costing, undefined, "bundled levels carry none");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ## TODO: Test Permutations
// - t switches real time on and the events stream pushes a new screen each beat
// - Esc closes an open panel without ending the game
// - several keys in one POST are applied in order
