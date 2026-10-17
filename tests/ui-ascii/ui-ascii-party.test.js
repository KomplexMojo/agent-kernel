/**
 * Party control in the terminal UI (Phase 2). Tab outside a panel plays the next party
 * member (an actor authored user_controlled); the screen lists the party and, by label,
 * everyone in sight. `--session <file>` keeps one game across calls, so a caller that is
 * not at a terminal (`ak play-session`, the MCP tools) can play it a few turns at a time.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const { createGame } = require("../../packages/ui-ascii/src/game.js");
const { INTENT, intentForKey } = require("../../packages/ui-ascii/src/keymap.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/ui-ascii/src/cli.mjs");

const ROOM = [
  "#########",
  "S.......#",
  "#.......#",
  "#.......#",
  "#.......E",
  "#########",
];
const delver = (id, position, motivations) => ({ category: "delver", id, position, vitals: viableVitals(), motivations });
const ACTORS = [
  delver("hero-a", { x: 1, y: 1 }, ["user_controlled"]),
  delver("hero-b", { x: 3, y: 3 }, ["user_controlled"]),
  { category: "warden", id: "guard", position: { x: 2, y: 2 }, vitals: viableVitals(), motivations: ["stationary"] },
];

function partyLevel(actors = ACTORS) {
  return { name: "party-room", ...buildUnifiedLevel({ id: "party_room", tiles: ROOM, actors }) };
}

function levelFiles() {
  const dir = mkdtempSync(join(tmpdir(), "ui-ascii-party-"));
  const { simConfig, initialState } = partyLevel();
  writeFileSync(join(dir, "sim-config.json"), JSON.stringify(simConfig));
  writeFileSync(join(dir, "initial-state.json"), JSON.stringify(initialState));
  return dir;
}

function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
  return { ...result, json: result.status === 0 && args.includes("--json") ? JSON.parse(result.stdout) : null };
}

test("Tab outside a panel plays the next party member, for free", async () => {
  assert.equal(intentForKey("\t").type, INTENT.NEXT_TARGET);
  const game = await createGame({ levels: [partyLevel()], showHelp: false });
  const { turns } = game.state();
  await game.handle(intentForKey("\t"));
  assert.equal(game.state().active, "hero-b");
  assert.equal(game.state().turns, turns, "a switch is not a turn");
  assert.match(game.screen(), /You now play hero-b \(D2\)\./);
  assert.match(game.screen(), /Party: D1 hero-a {2}\[D2 hero-b\]/);
  await game.handle(intentForKey("\t"));
  assert.equal(game.state().active, "hero-a", "Tab wraps round the party");
});

test("a lone player has no one to switch to; the party line is left off", async () => {
  const solo = partyLevel([ACTORS[0], ACTORS[2]]);
  const game = await createGame({ levels: [solo], showHelp: false });
  await game.handle(intentForKey("\t"));
  assert.equal(game.state().active, "hero-a");
  assert.match(game.screen(), /No one else in your party to play\./);
  assert.doesNotMatch(game.screen(), /Party:/);
});

test("the screen names everyone in sight by label", async () => {
  const game = await createGame({ levels: [partyLevel()], showHelp: false });
  assert.match(game.screen(), /In sight: .*W1 guard/);
});

test("motivations explain behaviour: in sight, in the target panel and in the party line beyond user_controlled (#310)", async () => {
  const pal = { category: "delver", id: "hero-c", position: { x: 2, y: 3 }, vitals: viableVitals(), motivations: ["user_controlled", "exploring"] };
  const game = await createGame({ levels: [partyLevel([...ACTORS, pal])], showHelp: false });
  assert.match(game.screen(), /In sight: .*W1 guard \(stationary\)/);
  assert.match(game.screen(), /Party: \[D1 hero-a\] {2}D2 hero-b {2}D3 hero-c \(exploring\)/,
    "every party member is user_controlled, so only the rest of the stack is shown");
  await game.handle(intentForKey("f"));
  assert.match(game.screen(), /Target: guard \(stationary\)/);
});

test("structured commands take labels for the actor and the target", async () => {
  const game = await createGame({ levels: [partyLevel()], showHelp: false });
  const moved = await game.command({ kind: "move", params: { direction: "east" }, actorId: "D2" });
  assert.equal(moved.accepted[0].actorId, "hero-b");
  assert.equal(game.state().active, "hero-a", "commanding a member does not seat it");
  assert.equal((await game.command({ kind: "switch", actorId: "W1" })).reason, "not_playable");
  assert.equal(game.state().turns, 1);
});

test("an order is a turn, and the screen lists who is under orders", async () => {
  const pal = { category: "delver", id: "pal", position: { x: 5, y: 3 }, vitals: viableVitals(), motivations: ["stationary", "goal_oriented"] };
  const game = await createGame({ levels: [partyLevel([...ACTORS, pal])], showHelp: false });
  const result = await game.command({ kind: "order", actorId: "D3", strategy: { goals: [{ kind: "reach", place: { x: 7, y: 3 } }] } });
  assert.equal(result.ok, true);
  assert.equal(game.state().turns, 1);
  assert.match(game.screen(), /D3 takes the order\./);
  assert.match(game.screen(), /Orders: D3 reach 7,3/);
  await game.command({ kind: "advance", ticks: 5, until: "orders_done" });
  assert.match(game.screen(), /Orders: D3 done/);
  assert.equal((await game.command({ kind: "order", actorId: "W1", strategy: { goals: [{ kind: "survive" }] } })).reason, "not_yours");
});

test("--session keeps one game across calls and reopens its own level", () => {
  const dir = levelFiles();
  const session = join(dir, "game.json");
  const first = cli(["--session", session, "--sim-config", join(dir, "sim-config.json"),
    "--initial-state", join(dir, "initial-state.json"), "--keys", "d", "--json", "--no-help"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.turns, 1);
  assert.equal(first.json.active, "hero-a");
  assert.deepEqual(first.json.party.map((member) => member.label), ["D1", "D2"]);
  assert.deepEqual(first.json.party.map((member) => member.motivations), [["user_controlled"], ["user_controlled"]]);
  assert.deepEqual(first.json.inSight.find((actor) => actor.id === "guard")?.motivations, ["stationary"]);
  assert.ok(existsSync(session));
  assert.match(first.json.hud, /^D1 hero-a · HP 10\/10/);

  const second = cli(["--session", session, "--actor", "D2", "--commands",
    JSON.stringify([{ kind: "move", params: { direction: "east" } }]), "--keys", ".", "--json", "--no-help"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.json.turns, 3);
  assert.equal(second.json.active, "hero-b");
  assert.equal(second.json.results[0].ok, true);

  const third = cli(["--session", session, "--json", "--no-help"]);
  assert.equal(third.json.turns, 3, "a call with nothing to play plays nothing");
  assert.equal(third.json.active, "hero-b", "the seat is saved with the game");
});

test("--session refuses level options once the game exists, and --actor needs --session", () => {
  const dir = levelFiles();
  const session = join(dir, "game.json");
  cli(["--session", session, "--sim-config", join(dir, "sim-config.json"), "--initial-state", join(dir, "initial-state.json"), "--json"]);
  const again = cli(["--session", session, "--level", "first-steps", "--json"]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already holds a game/);
  assert.equal(cli(["--actor", "D1", "--keys", "."]).status, 2);
});

// ## TODO: Test Permutations
// - --commands with malformed JSON or a non-array exits 2 with the reason.
// - a session on a bundled level (--level) reopens by name.
// - Tab while a panel is open still moves the panel's highlight, not the seat.
// - a defeated party member stays listed as "(defeated)" and can be seated but not commanded.
// - an order with a malformed strategy says why in the message line and runs no turn.
// - a stalled or searching order shows its status in brackets on the Orders line.
